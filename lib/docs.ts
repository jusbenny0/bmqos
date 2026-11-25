import "server-only";
import { readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { sql } from "./db";
import { scrub } from "./inbox";

/* Documents: SQLite FTS5 index (used by ⌘K too) over file roots + Paperclip documents.
   Secrets: ignored files aren't indexed, text is scrubbed on both index and display; only files can be edited, with version history. */
export interface DocRow { id: string; src: string; path: string; title: string; mtime: number }
const IGNORE = /(^|\/)(\.env[^/]*|[^/]*\.(key|pem|p12)|secrets?|node_modules|\.git|\.next)(\/|$)/i;
const MAX = 500_000;
export const docsWriteOn = (): boolean => process.env.OS_DOCS_WRITE === "1";

/* roots: OS_DOC_ROOTS="label|path;…"; default = agent context, vault, projects */
const roots = (): { src: string; dir: string }[] => {
  if (process.env.OS_DOC_ROOTS) return process.env.OS_DOC_ROOTS.split(";").filter(Boolean).map((x) => { const [src, dir] = x.split("|"); return { src, dir }; });
  const r: { src: string; dir: string }[] = [];
  return r;
};

const db = () => {
  const d = sql();
  d.exec(`CREATE TABLE IF NOT EXISTS doc (id TEXT PRIMARY KEY, src TEXT, path TEXT, title TEXT, mtime INTEGER);
CREATE VIRTUAL TABLE IF NOT EXISTS doc_fts USING fts5(id UNINDEXED, title, body, tokenize='unicode61 remove_diacritics 2');
CREATE TABLE IF NOT EXISTS doc_ver (id TEXT, at TEXT, body TEXT);
CREATE TABLE IF NOT EXISTS doc_meta (k TEXT PRIMARY KEY, v TEXT)`);
  return d;
};

/* single filter for both indexing and editing: no dotted segments; for projects only README.md and docs/ */
const isProj = (src: string, dir: string): boolean => src.startsWith("projekt/") ;
const allowedRel = (rel: string, proj: boolean): boolean => {
  const seg = rel.split("/");
  if (IGNORE.test(rel) || seg.some((x) => x.startsWith(".")) || !/\.(md|txt)$/i.test(rel)) return false;
  return !proj || rel === "README.md" || seg[0] === "docs";
};
/* never overwrite agent instructions or dependencies */
const PROTECTED = /(^|\/)(CLAUDE\.md|AGENTS\.md|requirements[^/]*\.txt)$/i;

const walk = (dir: string, base: string, proj: boolean, out: string[]): void => {
  let ents; try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const abs = join(dir, e.name), rel = relative(base, abs).split(sep).join("/");
    if (IGNORE.test(rel) || e.name.startsWith(".")) continue;
    if (e.isDirectory()) { if (!proj || dir !== base || e.name === "docs") walk(abs, base, proj, out); }
    else if (allowedRel(rel, proj)) out.push(abs);
  }
};

const titleOf = (body: string, fallback: string): string => /^#\s+(.+)$/m.exec(body)?.[1].trim().slice(0, 120) ?? fallback;
const put = (d: ReturnType<typeof db>, id: string, src: string, path: string, body: string, mtime: number): void => {
  const clean = scrub(body), title = titleOf(clean, (path.split("/").pop() ?? path).replace(/\.md$/i, "").replace(/[-_]+/g, " "));
  d.prepare("DELETE FROM doc_fts WHERE id=?").run(id);
  d.prepare("INSERT OR REPLACE INTO doc VALUES (?,?,?,?,?)").run(id, src, path, title, mtime);
  d.prepare("INSERT INTO doc_fts (id,title,body) VALUES (?,?,?)").run(id, title, clean);
};

/* Paperclip documents: recent tasks (OS_DOCS_ISSUES, default 150) */
const paperclip = async (d: ReturnType<typeof db>): Promise<number> => {
  const base = process.env.PAPERCLIP_API_URL, C = process.env.PAPERCLIP_COMPANY_ID;
  if (!base || !C) return 0;
  const get = async <T>(p: string): Promise<T | null> => {
    const r = await fetch(base + p, { headers: { Authorization: `Bearer ${process.env.PAPERCLIP_API_TOKEN ?? ""}` }, cache: "no-store", signal: AbortSignal.timeout(15_000) }).catch(() => null);
    return r?.ok ? ((await r.json()) as T) : null;
  };
  const issues = (await get<{ id: string; identifier: string; title: string }[]>(`/companies/${C}/issues?limit=${process.env.OS_DOCS_ISSUES ?? 150}`)) ?? [];
  let n = 0;
  for (const i of issues) {
    const list = (await get<{ key: string }[]>(`/issues/${i.id}/documents`)) ?? [];
    for (const k of list) {
      const doc = await get<{ body: string; updatedAt?: string }>(`/issues/${i.id}/documents/${k.key}`);
      if (doc?.body) { put(d, `paperclip:${i.identifier}/${k.key}`, "paperclip", `${i.identifier} · ${k.key}`, `# ${i.identifier} · ${i.title}\n${doc.body}`, Date.parse(doc.updatedAt ?? "") || Date.now()); n++; }
    }
  }
  return n;
};

export const reindex = async (): Promise<{ files: number; paperclip: number }> => {
  const d = db();
  const seen = new Set<string>();
  let files = 0;
  for (const { src, dir } of roots()) {
    const list: string[] = [];
    walk(dir, dir, isProj(src, dir), list);
    for (const f of list) {
      const id = `${src}:${relative(dir, f).split(sep).join("/")}`, st = statSync(f);
      seen.add(id);
      if (st.size > MAX) continue;
      const old = d.prepare("SELECT mtime FROM doc WHERE id=?").get(id) as { mtime: number } | undefined;
      if (old?.mtime === Math.floor(st.mtimeMs)) continue;
      put(d, id, src, id.slice(src.length + 1), readFileSync(f, "utf8"), Math.floor(st.mtimeMs));
      files++;
    }
  }
  for (const r of d.prepare("SELECT id FROM doc WHERE src!='paperclip'").all() as { id: string }[])
    if (!seen.has(r.id)) { d.prepare("DELETE FROM doc WHERE id=?").run(r.id); d.prepare("DELETE FROM doc_fts WHERE id=?").run(r.id); }
  const paperclipN = await paperclip(d).catch(() => 0);
  d.prepare("INSERT OR REPLACE INTO doc_meta VALUES ('at', ?)").run(String(Date.now()));
  return { files, paperclip: paperclipN };
};

/* lazy refresh: older than 10 min (and never concurrent) */
let running: Promise<unknown> | null = null;
const fresh = async (): Promise<void> => {
  const at = Number((db().prepare("SELECT v FROM doc_meta WHERE k='at'").get() as { v: string } | undefined)?.v ?? 0);
  if (Date.now() - at < 600_000) return;
  running ??= reindex().finally(() => { running = null; });
  await running;
};
/* manual reindex: shares the lock with fresh(), at most once per 30 s */
export const reindexNow = async (): Promise<{ files: number; paperclip: number }> => {
  const at = Number((db().prepare("SELECT v FROM doc_meta WHERE k='at'").get() as { v: string } | undefined)?.v ?? 0);
  if (!running && Date.now() - at < 30_000) throw new Error("index is fresh, try again in a moment");
  running ??= reindex().finally(() => { running = null; });
  return (await running) as { files: number; paperclip: number };
};

export const fts = (q: string): string => q.split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}_-]/gu, "")).filter(Boolean).map((w) => `"${w}"*`).join(" ");

export interface Hit extends DocRow { snippet: string }
/* search – also exported for ⌘K */
export const searchDocs = async (q: string, limit = 20): Promise<Hit[]> => {
  await fresh();
  const m = fts(q);
  if (!m) return [];
  return db().prepare(`SELECT d.id, d.src, d.path, d.title, d.mtime, snippet(doc_fts, 2, '«', '»', '…', 14) snippet
    FROM doc_fts JOIN doc d ON d.id = doc_fts.id WHERE doc_fts MATCH ? ORDER BY rank LIMIT ?`).all(m, limit) as unknown as Hit[];
};
export const listDocs = async (src?: string): Promise<DocRow[]> => {
  await fresh();
  return (src ? db().prepare("SELECT * FROM doc WHERE src=? ORDER BY mtime DESC LIMIT 500").all(src) : db().prepare("SELECT * FROM doc ORDER BY mtime DESC LIMIT 500").all()) as unknown as DocRow[];
};

export const fileOf = (id: string): string | null => {
  const i = id.indexOf(":"), r = roots().find((x) => x.src === id.slice(0, i));
  if (!r || IGNORE.test(id.slice(i + 1)) || !/\.(md|txt)$/i.test(id)) return null;
  try {
    const f = realpathSync(resolve(r.dir, id.slice(i + 1))), top = realpathSync(r.dir);
    return f.startsWith(top + sep) ? f : null;
  } catch { return null; }
};

export const readDoc = (id: string): { id: string; title: string; body: string; editable: boolean; versions: { at: string }[] } | null => {
  const d = db(), row = d.prepare("SELECT title FROM doc WHERE id=?").get(id) as { title: string } | undefined;
  if (!row) return null;
  const f = fileOf(id);
  const raw = f ? readFileSync(f, "utf8") : "";
  const body = f ? scrub(raw) : (d.prepare("SELECT body FROM doc_fts WHERE id=?").get(id) as { body: string } | undefined)?.body ?? "";
  return { id, title: row.title, body, editable: !!f && scrub(raw) === raw && !PROTECTED.test(f), versions: d.prepare("SELECT at FROM doc_ver WHERE id=? ORDER BY at DESC LIMIT 30").all(id) as { at: string }[] };
};
export const versionBody = (id: string, at: string): string | null => (db().prepare("SELECT body FROM doc_ver WHERE id=? AND at=?").get(id, at) as { body: string } | undefined)?.body ?? null;

/* editing md: files without secrets only, previous content goes to history; authorization, step-up and audit are handled by guarded() in the route */
export const saveDoc = (id: string, body: string): void => {
  const f = fileOf(id), i = id.indexOf(":"), r = roots().find((x) => x.src === id.slice(0, i));
  if (!f || !r || !readDoc(id)) throw new Error("document cannot be edited");
  const rel = id.slice(i + 1), real = relative(realpathSync(r.dir), f).split(sep).join("/");
  if (!allowedRel(rel, isProj(r.src, r.dir)) || !allowedRel(real, isProj(r.src, r.dir)) || PROTECTED.test(rel) || PROTECTED.test(real)) throw new Error("document cannot be edited");
  if (body.length > MAX) throw new Error("too long");
  const old = readFileSync(f, "utf8");
  if (scrub(old) !== old) throw new Error("document contains secrets – edit it outside the OS");
  if (scrub(body) !== body) throw new Error("text looks like a token/password");
  const d = db();
  d.prepare("INSERT INTO doc_ver VALUES (?,?,?)").run(id, new Date().toISOString(), old);
  writeFileSync(f, body);
  put(d, id, id.slice(0, id.indexOf(":")), id.slice(id.indexOf(":") + 1), body, Math.floor(statSync(f).mtimeMs));
};
