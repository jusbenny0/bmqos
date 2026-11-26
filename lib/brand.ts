import "server-only";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { sql } from "./db";
import { demoOn } from "./demo";
import { append } from "./audit";
import { zip } from "./zip";
import { refTemplate } from "./brandtpl";
import { EMPTY_KIT, FORMATS, htmlViolation, isFormat, setSlots, slug, validateBrief, validateKit, type BrandFormat, type BrandKit, type Brief } from "./brandkit";

// Brand: projects with a brand kit, generated images (HTML designed by Claude -> PNG via headless Chromium), gallery, ZIP export.
// Files live in data/brand/<project>/ (logo-*, fonts/, examples/, out/<asset>.png). No paid image APIs.
const ROOT = (): string => process.env.OS_BRAND_DIR ?? "data/brand";
const now = (): string => new Date().toISOString();
// A path inside the brand directory of one project; throws on escape.
export function safePath(root: string, ...parts: string[]): string {
  const base = path.resolve(root);
  const p = path.resolve(base, ...parts);
  if (p !== base && !p.startsWith(base + path.sep)) throw new Error("path outside the brand directory");
  return p;
}

const dir = (id: string): string => safePath(ROOT(), id);

export type Project = { id: string; name: string; kit: BrandKit; kit_rev: number; created: string; updated: string; assets: number; last_asset: number | null; template_only: boolean };
type PRow = { id: string; name: string; kit: string; kit_rev: number; created: string; updated: string };
type ARow = { id: number; project: string; gen: number; parent_id: number | null; format: string; w: number; h: number; brief: string; html: string; png_path: string | null; bytes: number | null; kit_rev: number; starred: number; status: string; error: string | null; created: string };
export type Asset = { id: number; project: string; gen: number; parent_id: number | null; format: BrandFormat; w: number; h: number; brief: Brief; status: string; error: string | null; starred: boolean; kit_rev: number; kit_changed: boolean; bytes: number | null; created: string; png_url: string | null; html?: string };

const toProject = (r: PRow): Project => {
  const c = sql().prepare("SELECT COUNT(*) n, MAX(id) m FROM brand_asset WHERE project = ? AND status = 'done'").get(r.id) as { n: number; m: number | null };
  return { ...r, kit: validateKit(JSON.parse(r.kit)), assets: c.n, last_asset: c.m, template_only: mock() };
};
const toAsset = (r: ARow, kitRev: number, html = false): Asset => ({
  id: r.id, project: r.project, gen: r.gen, parent_id: r.parent_id, format: r.format as BrandFormat, w: r.w, h: r.h, brief: JSON.parse(r.brief) as Brief, status: r.status, error: r.error,
  starred: !!r.starred, kit_rev: r.kit_rev, kit_changed: r.kit_rev < kitRev, bytes: r.bytes, created: r.created,
  png_url: r.status === "done" && r.png_path ? `/api/brand/${r.project}/assets/${r.id}.png` : null, ...(html ? { html: r.html } : {}),
});

export function listProjects(): Project[] {
  if (demoOn() && !(sql().prepare("SELECT 1 FROM brand_project LIMIT 1").get())) seedDemo();
  return (sql().prepare("SELECT * FROM brand_project ORDER BY updated DESC").all() as PRow[]).map(toProject);
}
export const getProject = (id: string): Project | null => {
  const r = sql().prepare("SELECT * FROM brand_project WHERE id = ?").get(id) as PRow | undefined;
  return r ? toProject(r) : null;
};

export function createProject(name: unknown, kit?: unknown): Project {
  if (typeof name !== "string" || !name.trim() || name.length > 60) throw new Error("name: 1-60 characters");
  const base = slug(name) || "brand";
  let id = base;
  for (let i = 2; getProject(id); i++) id = `${base}-${i}`;
  const k = validateKit(kit);
  sql().prepare("INSERT INTO brand_project (id, name, kit, kit_rev, created, updated) VALUES (?, ?, ?, 1, ?, ?)").run(id, name.trim(), JSON.stringify(k), now(), now());
  fs.mkdirSync(dir(id), { recursive: true });
  return getProject(id)!;
}

export function patchProject(id: string, body: { name?: unknown; kit?: unknown }): Project {
  const p = getProject(id);
  if (!p) throw new Error("not found");
  if (body.name !== undefined && (typeof body.name !== "string" || !body.name.trim() || body.name.length > 60)) throw new Error("name: 1-60 characters");
  const kit = body.kit === undefined ? p.kit : validateKit(body.kit, p.kit);
  const changed = JSON.stringify(kit) !== JSON.stringify(p.kit);
  sql().prepare("UPDATE brand_project SET name = ?, kit = ?, kit_rev = ?, updated = ? WHERE id = ?").run((body.name as string | undefined)?.trim() ?? p.name, JSON.stringify(kit), p.kit_rev + (changed ? 1 : 0), now(), id);
  return getProject(id)!;
}

export function deleteProject(id: string): void {
  if (!getProject(id)) throw new Error("not found");
  sql().prepare("DELETE FROM brand_asset WHERE project = ?").run(id);
  sql().prepare("DELETE FROM brand_project WHERE id = ?").run(id);
  fs.rmSync(dir(id), { recursive: true, force: true });
}

// ---- uploads: type is detected from the bytes, names are regenerated
const KINDS = ["logo-primary", "logo-mark", "logo-mono", "font-display", "font-body", "example"] as const;
export function attachFile(id: string, kind: string, bytes: Buffer): Project {
  const p = getProject(id);
  if (!p) throw new Error("not found");
  if (!(KINDS as readonly string[]).includes(kind)) throw new Error("kind: unknown");
  const head = bytes.subarray(0, 12);
  const png = head.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])), jpg = head.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  const woff = head.subarray(0, 4).toString("latin1") === "wOF2";
  const svg = /^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)?<svg\b/i.test(bytes.subarray(0, 600).toString("utf8"));
  let ext: string, sub = "", max = 1_000_000;
  if (kind.startsWith("logo")) { if (!png && !svg) throw new Error("logo: SVG or PNG"); ext = svg ? "svg" : "png"; }
  else if (kind.startsWith("font")) { if (!woff) throw new Error("font: WOFF2 file"); ext = "woff2"; sub = "fonts"; max = 2_000_000; }
  else { if (!png && !jpg) throw new Error("example: PNG or JPG"); ext = png ? "png" : "jpg"; sub = "examples"; max = 2_000_000; }
  if (bytes.length > max) throw new Error(`file: max ${max / 1_000_000} MB`);
  if (svg) { const v = htmlViolation(bytes.toString("utf8")); if (v) throw new Error(`SVG rejected: ${v}`); }
  const name = `${kind.startsWith("logo") ? "logo-" : ""}${randomBytes(6).toString("hex")}.${ext}`;
  const rel = sub ? `${sub}/${name}` : name;
  const abs = safePath(dir(id), rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, bytes);
  const kit = structuredClone(p.kit);
  if (kind.startsWith("logo")) kit.logo[kind.slice(5) as "primary" | "mark" | "mono"] = rel;
  else if (kind.startsWith("font")) { const f = kind === "font-display" ? kit.fonts.display : kit.fonts.body; f.file = rel; }
  else kit.examples = [...kit.examples, rel].slice(-6);
  return patchProject(id, { kit });
}

export function fileOf(id: string, rel: string): { path: string; type: string } | null {
  try {
    const p = safePath(dir(id), rel);
    return fs.existsSync(p) ? { path: p, type: p.endsWith(".svg") ? "image/svg+xml" : p.endsWith(".png") ? "image/png" : "application/octet-stream" } : null;
  } catch { return null; }
}

// ---- assets
export function listAssets(id: string, q: { gen?: number; format?: string; starred?: boolean } = {}): Asset[] {
  const p = getProject(id);
  if (!p) throw new Error("not found");
  const rows = sql().prepare("SELECT * FROM brand_asset WHERE project = ? ORDER BY gen DESC, id").all(id) as ARow[];
  return rows.filter((r) => (q.gen === undefined || r.gen === q.gen) && (!q.format || r.format === q.format) && (!q.starred || r.starred)).map((r) => toAsset(r, p.kit_rev));
}
export function getAsset(id: string, aid: number, html = false): Asset | null {
  const p = getProject(id), r = sql().prepare("SELECT * FROM brand_asset WHERE id = ? AND project = ?").get(aid, id) as ARow | undefined;
  return p && r ? toAsset(r, p.kit_rev, html) : null;
}
const setAsset = (aid: number, f: Record<string, string | number | null>): void => {
  sql().prepare(`UPDATE brand_asset SET ${Object.keys(f).map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).run(...Object.values(f), aid);
};

export function generate(id: string, format: unknown, brief: unknown, n: unknown = 3, parent?: number): Asset[] {
  const p = getProject(id);
  if (!p) throw new Error("not found");
  if (!isFormat(format)) throw new Error("format: post | story | og | banner");
  if (!p.kit.logo.primary && !p.kit.logo.mark) throw new Error("Add logo and colors first");
  const count = Math.max(1, Math.min(6, Math.floor(Number(n)) || 3));
  const b = validateBrief(format, brief);
  const par = parent ? (sql().prepare("SELECT html FROM brand_asset WHERE id = ? AND project = ?").get(parent, id) as { html: string } | undefined) : undefined;
  const gen = ((sql().prepare("SELECT MAX(gen) m FROM brand_asset WHERE project = ?").get(id) as { m: number | null }).m ?? 0) + 1;
  const { w, h } = FORMATS[format];
  const ids: number[] = [];
  for (let i = 0; i < count; i++) ids.push(Number(sql().prepare("INSERT INTO brand_asset (project, gen, parent_id, format, w, h, brief, html, kit_rev, status, created) VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, 'queued', ?)").run(id, gen, parent ?? null, format, w, h, JSON.stringify(b), p.kit_rev, now()).lastInsertRowid));
  append({ action: "brand.generate", tier: 1, target: id, params: { format, n: count }, status: "ok" });
  ids.forEach((aid, i) => enqueue(() => work(id, aid, i, par?.html)));
  return listAssets(id, { gen });
}

export function patchAsset(id: string, aid: number, body: { starred?: unknown; brief?: unknown; retry?: unknown }): Asset {
  const a = getAsset(id, aid, true);
  if (!a) throw new Error("not found");
  if (body.starred !== undefined) setAsset(aid, { starred: body.starred ? 1 : 0 });
  if (body.brief !== undefined) {
    const b = validateBrief(a.format, { ...a.brief, ...(body.brief as object) });
    setAsset(aid, { brief: JSON.stringify(b), html: setSlots(a.html ?? "", b), status: "rendering", error: null });
    enqueue(() => work(id, aid, 0, undefined, true));
  } else if (body.retry) {
    setAsset(aid, { status: "queued", error: null });
    enqueue(() => work(id, aid, 0, undefined, !!a.html));
  }
  return getAsset(id, aid)!;
}

export function deleteAsset(id: string, aid: number): void {
  const a = getAsset(id, aid);
  if (!a) throw new Error("not found");
  sql().prepare("DELETE FROM brand_asset WHERE id = ?").run(aid);
  if (a.status === "done") fs.rmSync(safePath(dir(id), "out", `${aid}.png`), { force: true });
}

export function pngOf(id: string, aid: number): { path?: string; redirect?: string } | null {
  const r = sql().prepare("SELECT png_path FROM brand_asset WHERE id = ? AND project = ? AND status = 'done'").get(aid, id) as { png_path: string | null } | undefined;
  if (!r?.png_path) return null;
  if (r.png_path.startsWith("@demo/")) return { redirect: `/brand-demo/${r.png_path.slice(6)}` };
  const f = fileOf(id, r.png_path);
  return f ? { path: f.path } : null;
}

// ---- queue (max 2 renders at once)
const q: (() => Promise<void>)[] = [];
let active = 0;
function enqueue(fn: () => Promise<void>): void {
  q.push(fn);
  const next = (): void => {
    while (active < 2 && q.length) { active++; void q.shift()!().catch(() => undefined).finally(() => { active--; next(); }); }
  };
  next();
}
export const idle = async (): Promise<void> => { while (active || q.length) await new Promise((r) => setTimeout(r, 50)); };

async function work(id: string, aid: number, idx: number, parentHtml?: string, renderOnly = false): Promise<void> {
  const p = getProject(id), a = getAsset(id, aid, true);
  if (!p || !a) return;
  try {
    let html = a.html ?? "";
    if (!renderOnly) {
      setAsset(aid, { status: "designing" });
      html = mock() ? refTemplate(a.format, p.kit, a.brief, idx + (a.parent_id ? 1 : 0)) : await design(p, a.format, a.brief, idx, parentHtml);
      const bad = htmlViolation(html);
      if (bad) throw new Error(`HTML rejected: ${bad}`);
      setAsset(aid, { html });
    }
    setAsset(aid, { status: "rendering" });
    const { size } = await render(p, aid, html, a.w, a.h);
    setAsset(aid, { status: "done", png_path: `out/${aid}.png`, bytes: size, error: null });
  } catch (e) {
    setAsset(aid, { status: "failed", error: (e instanceof Error ? e.message : "failed").slice(0, 300) });
  }
}
// Template-only mode needs an explicit opt-in (OS_DEMO=1 or BRAND_MOCK=1); an instance without Paperclip still asks Claude and shows real errors.
export const mock = (): boolean => process.env.OS_DEMO === "1" || process.env.BRAND_MOCK === "1";

// ---- Claude designs the HTML (same `claude` CLI mechanism as the engine, no SDK)
function ask(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ["-p", "--model", process.env.BRAND_MODEL || "sonnet", "--output-format", "json", "--max-turns", "1",
      "--disallowedTools", "Bash,Edit,Write,Read,Glob,Grep,WebFetch,WebSearch", "--setting-sources", "project,local", "--", prompt];
    const c = spawn("claude", args, { cwd: os.tmpdir(), env: { PATH: process.env.PATH, HOME: process.env.HOME } as unknown as NodeJS.ProcessEnv, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const t = setTimeout(() => c.kill("SIGTERM"), 120_000);
    c.stdout.on("data", (d) => (out += d));
    c.on("error", () => { clearTimeout(t); reject(new Error("Claude is not available (claude CLI missing)")); });
    c.on("close", () => {
      clearTimeout(t);
      try {
        const j = JSON.parse(out) as { result?: string; is_error?: boolean };
        if (j.is_error || !j.result) return reject(new Error(j.result || "Claude returned nothing"));
        resolve(j.result);
      } catch { reject(new Error("Claude failed or timed out")); }
    });
  });
}

async function design(p: Project, f: BrandFormat, b: Brief, idx: number, parentHtml?: string): Promise<string> {
  const { w, h, max } = FORMATS[f];
  const ref = refTemplate(f, p.kit, { headline: "Headline", sub: "Sub line", cta: max.cta ? "CTA" : "" }, 0);
  const prompt = `You are a brand designer. Output ONE complete standalone HTML document (<!doctype html> … </html>) and nothing else, no code fences, no commentary.
Canvas: exactly ${w}x${h}px, <body style="margin:0;width:${w}px;height:${h}px;overflow:hidden">. Static: no JavaScript, no external URLs, no <link>, no @import, no <iframe>. CSS and inline SVG only.
Brand kit (use ONLY these colors, at most bg + ink + accent + muted; no gradients, no shadows, corners max 2px radius): ${JSON.stringify({ colors: p.kit.colors, display_font: p.kit.fonts.display.family, body_font: p.kit.fonts.body.family })}
Tone: ${p.kit.voice.tags.join(", ") || "neutral"}. Never say: ${p.kit.voice.never.join(", ") || "-"}. Voice samples: ${p.kit.voice.samples.join(" | ") || "-"}.
Logo: use <img src="{{logo_mark}}"> (square mark) or <img src="{{logo_primary}}"> (wide logo) exactly like that; the placeholders are replaced later. Keep a 64px safe margin${f === "story" ? " (story: 250px top and 340px bottom free of text)" : ""}.
Text (mark each element with data-slot so it can be edited): headline (data-slot="headline"): ${JSON.stringify(b.headline)}${b.sub ? `; sub (data-slot="sub"): ${JSON.stringify(b.sub)}` : ""}${b.cta ? `; CTA (data-slot="cta"): ${JSON.stringify(b.cta)}` : ""}. Use the text verbatim.
Layout rules for ${f}: headline in the display font, large (min ${f === "banner" ? 56 : 72}px), strong hierarchy, text must not overflow or overlap.${b.note ? ` Brief: ${b.note}` : ""}
This is composition ${idx + 1}: make it clearly different from the other compositions (text left/right, big shape, pattern or type-only).
${parentHtml ? `Create a variation of this design, same text, keep the brand:\n${parentHtml.slice(0, 12000)}\n` : `Reference template (structure example only):\n${ref}\n`}`;
  let last: Error = new Error("Claude failed");
  for (let i = 0; i < 2; i++) {
    try {
      const out = await ask(prompt);
      const m = out.match(/<!doctype html[\s\S]*<\/html>/i) ?? out.match(/<html[\s\S]*<\/html>/i);
      if (m) return m[0];
      last = new Error("Claude did not return an HTML document");
    } catch (e) { last = e as Error; }
  }
  throw last;
}

// ---- render: headless Chromium (same lookup as the engine's evidence) -> PNG
export function chrome(): string | null {
  const env = process.env.CREW_CHROME || process.env.BRAND_CHROME;
  if (env && fs.existsSync(env)) return env;
  const base = path.join(process.env.HOME || os.homedir(), ".cache", "ms-playwright");
  try {
    for (const d of fs.readdirSync(base).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse()) {
      const c = path.join(base, d, "chrome-linux64", "chrome");
      if (fs.existsSync(c)) return c;
    }
  } catch { /* no playwright cache */ }
  for (const c of ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"]) if (fs.existsSync(c)) return c;
  return null;
}

const dataUri = (id: string, rel?: string): string => {
  const f = rel ? fileOf(id, rel) : null;
  return f ? `data:${f.type};base64,${fs.readFileSync(f.path).toString("base64")}` : "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=";
};
export const pngSize = (b: Buffer): { w: number; h: number } => ({ w: b.readUInt32BE(16), h: b.readUInt32BE(20) });

async function render(p: Project, aid: number, html: string, w: number, h: number): Promise<{ size: number }> {
  const bin = chrome();
  if (!bin) throw new Error("Chromium not found (install Playwright Chromium or set BRAND_CHROME)");
  const k = p.kit;
  const faces = [k.fonts.display, k.fonts.body].filter((f) => f.file).map((f) => `@font-face{font-family:'${f.family}';src:url('${f.file}')}`).join("");
  const full = html.replace(/\{\{logo_(primary|mark|mono)\}\}/g, (_m, n: "primary" | "mark" | "mono") => dataUri(p.id, k.logo[n] ?? (n === "mono" ? k.logo.primary : k.logo.mark ?? k.logo.primary) ?? k.logo.mark))
    .replace(/<\/head>/i, `<style>${faces}</style></head>`);
  const src = safePath(dir(p.id), `render-${aid}.html`), out = safePath(dir(p.id), "out", `${aid}.png`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(src, full);
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), "brand-chrome-"));
  try {
    await new Promise<void>((resolve) => execFile(bin, ["--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars", `--user-data-dir=${prof}`, `--window-size=${w},${h}`, "--virtual-time-budget=4000", `--screenshot=${out}`, `file://${src}`], { timeout: 60_000 }, () => resolve()));
    const png = fs.existsSync(out) ? fs.readFileSync(out) : null;
    if (!png || png.length < 2048) throw new Error("render failed (no or too small PNG)");
    const s = pngSize(png);
    if (s.w !== w || s.h !== h) throw new Error(`render failed (size ${s.w}x${s.h}, expected ${w}x${h})`);
    return { size: png.length };
  } finally {
    fs.rmSync(prof, { recursive: true, force: true });
    fs.rmSync(src, { force: true });
  }
}

// ---- export ZIP
export function exportZip(id: string, ids: number[] | null, opt: { html?: boolean; kit?: boolean; formats?: string[] } = {}): { name: string; data: Buffer } {
  const p = getProject(id);
  if (!p) throw new Error("not found");
  const day = now().slice(0, 10).replace(/-/g, "");
  const top = `${p.id}-brand-${day}`;
  const rows = (sql().prepare("SELECT * FROM brand_asset WHERE project = ? AND status = 'done' ORDER BY id").all(id) as ARow[])
    .filter((r) => (!ids || ids.includes(r.id)) && (!opt.formats?.length || opt.formats.includes(r.format)));
  const files: { name: string; data: Buffer }[] = [];
  const nth: Record<string, number> = {};
  for (const r of rows) {
    const png = pngOf(id, r.id);
    const data = png?.path ? fs.readFileSync(png.path) : png?.redirect ? fs.readFileSync(path.join(process.env.PWD || ".", "public", png.redirect)) : null;
    if (!data) continue;
    const n = (nth[r.format] = (nth[r.format] ?? 0) + 1);
    const base = `${slug((JSON.parse(r.brief) as Brief).headline) || "image"}-v${n}`;
    files.push({ name: `${top}/${r.format}/${base}.png`, data });
    if (opt.html) files.push({ name: `${top}/html/${r.id}.html`, data: Buffer.from(r.html) });
  }
  if (opt.kit) files.push({ name: `${top}/kit.json`, data: Buffer.from(JSON.stringify({ name: p.name, kit_rev: p.kit_rev, kit: p.kit }, null, 2)) });
  return { name: `${top}.zip`, data: zip(files) };
}

// ---- demo: 2 projects with logos and pre-rendered PNGs in public/brand-demo/
const DEMO: { name: string; kit: BrandKit; logo: string; head: string }[] = [
  { name: "Northwind Coffee", head: "Slow mornings, strong coffee",
    logo: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#c9742b"/><circle cx="32" cy="32" r="16" fill="#f3e7d3"/><rect x="30" y="8" width="4" height="48" fill="#2a1a10"/></svg>`,
    kit: { ...EMPTY_KIT, colors: { bg: "#2a1a10", ink: "#f3e7d3", accent: "#e08a3c", muted: "#c7b299" }, fonts: { display: { family: "DM Serif Display" }, body: { family: "Lora" } }, voice: { tags: ["Warm", "Premium"], never: ["cheap"], samples: ["Roasted this week, poured this morning."] } } },
  { name: "Kvadr", head: "Ship the boring parts first",
    logo: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#0f1a14"/><rect x="12" y="12" width="40" height="40" fill="none" stroke="#7bd88f" stroke-width="5"/><rect x="26" y="26" width="12" height="12" fill="#7bd88f"/></svg>`,
    kit: { ...EMPTY_KIT, colors: { bg: "#0f1a14", ink: "#e8f1ea", accent: "#7bd88f", muted: "#9db3a3" }, fonts: { display: { family: "JetBrains Mono" }, body: { family: "IBM Plex Sans" } }, voice: { tags: ["Technical", "Direct"], never: ["synergy"], samples: ["Fewer moving parts. More uptime."] } } },
];
export function seedDemo(): void {
  DEMO.forEach((d, i) => {
    const p = createProject(d.name, d.kit);
    const rel = "logo-demo.svg";
    fs.writeFileSync(safePath(dir(p.id), rel), d.logo);
    patchProject(p.id, { kit: { logo: { primary: rel, mark: rel } } });
    (["post", "og", "story"] as BrandFormat[]).forEach((f, j) => {
      const b: Brief = { headline: d.head, sub: f === "story" ? "Our new season, in your hands." : "Small batches. Honest craft.", cta: f === "og" ? "" : "Read more" };
      const html = refTemplate(f, getProject(p.id)!.kit, b, j);
      sql().prepare("INSERT INTO brand_asset (project, gen, parent_id, format, w, h, brief, html, png_path, bytes, kit_rev, starred, status, created) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL, 2, ?, 'done', ?)")
        .run(p.id, j + 1, f, FORMATS[f].w, FORMATS[f].h, JSON.stringify(b), html, `@demo/${i}-${f}.png`, j === 0 ? 1 : 0, now());
    });
  });
}
