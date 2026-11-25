import "server-only";
import { sql } from "./db";
import { judgeOf, PR_URL } from "./merge";
import { demoCard, demoOn } from "./demo";

/* ---------- card data model ---------- */
export interface Msg { text: string; author: string; at: string; via: string }
export interface Attach { type: "video" | "image" | "file" | "link"; url: string; title: string; meta: string; note: string; vid?: string }
export interface Opt { key: string; label: string; consequence: string; recommended: boolean }
export interface Answer { value: string; at: string; sent: boolean }
export interface Question { id: string; text: string; options: Opt[]; answer?: Answer }
export interface Card {
  issue: string; title: string; kind: string; lead: string; url: string; write: boolean;
  original: { messages: Msg[]; attachments: Attach[]; found: boolean; brief: string };
  outcome: { lines: string[]; rows: [string, string][]; links: [string, string][]; media: [string, string][] };
  questions: Question[];
  next: { owner: string; text: string; stage: number };
}

interface PIssue { id: string; identifier: string; title: string; status: string; description: string | null; parentId: string | null; assigneeAgentId: string | null }
interface PDoc { key: string; body: string }
interface PComment { authorAgentId: string | null; authorType: string; body: string; createdAt: string }

const base = (): string => process.env.PAPERCLIP_API_URL ?? "";
const auth = (): Record<string, string> => ({ Authorization: `Bearer ${process.env.PAPERCLIP_API_TOKEN ?? ""}` });
const pc = async <T>(path: string): Promise<T | null> => {
  const res = await fetch(`${base()}${path}`, { headers: auth(), cache: "no-store", signal: AbortSignal.timeout(15_000) }).catch(() => null);
  return res?.ok ? ((await res.json()) as T) : null;
};

export const writeOn = (): boolean => process.env.PAPERCLIP_WRITE === "1";
export const ISSUE = /^[A-Z]{2,6}-\d{1,6}$/;

/* tokens, passwords and .env never reach the client */
export const scrub = (s: string): string =>
  s.replace(/\b(pcp|sk|ghp|gho|github_pat|xox[bp])[_-][A-Za-z0-9_-]{12,}/g, "[hidden]")
    .replace(/(Bearer\s+)[A-Za-z0-9._-]{12,}/gi, "$1[hidden]")
    .replace(/((?:token|password|heslo|secret|api[_-]?key)\s*[=:]\s*)\S+/gi, "$1[hidden]");

/* ---------- text parsing ---------- */
const YT = /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/;
const IMG = /\.(png|jpe?g|webp|gif)(\?|$)/i;

const oembed = new Map<string, { title: string; by: string }>();
const ytInfo = async (id: string): Promise<{ title: string; by: string }> => {
  const hit = oembed.get(id);
  if (hit) return hit;
  const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`, { signal: AbortSignal.timeout(6000) }).catch(() => null);
  const j = r?.ok ? ((await r.json()) as { title?: string; author_name?: string }) : null;
  const v = { title: j?.title ?? `YouTube ${id}`, by: j?.author_name ?? "" };
  if (j) oembed.set(id, v);
  return v;
};

// line "- URL — note" or a URL in the text → attachment
const attachOf = async (url: string, note: string): Promise<Attach> => {
  const y = YT.exec(url);
  if (y) { const i = await ytInfo(y[1]); return { type: "video", url, title: i.title, meta: i.by, note, vid: y[1] }; }
  const host = (() => { try { return new URL(url).host; } catch { return url; } })();
  return { type: IMG.test(url) ? "image" : "link", url, title: host, meta: "", note };
};

// "Request from the owner" block: `> message` + line `— Owner · date · source`, then `- URL — note`
const parseZadani = async (body: string): Promise<{ messages: Msg[]; attachments: Attach[] }> => {
  const messages: Msg[] = [];
  const lines = body.split("\n");
  let quote: string[] = [];
  const flush = (meta?: string): void => {
    if (!quote.length) return;
    const [author = "the owner", at = "", via = "from Discord"] = (meta ?? "— the owner").replace(/^[—-]\s*/, "").split("·").map((x) => x.trim());
    messages.push({ text: scrub(quote.join(" ")), author, at, via });
    quote = [];
  };
  const links: [string, string][] = [];
  for (const l of lines) {
    if (l.startsWith(">")) quote.push(l.replace(/^>\s?/, "").trim());
    else if (/^[—-]\s*\S/.test(l) && quote.length) flush(l);
    else {
      flush();
      const m = /^\s*[-*]\s*(https?:\/\/\S+)\s*(?:[—-]\s*(.*))?$/.exec(l);
      if (m) links.push([m[1], m[2] ?? ""]);
    }
  }
  flush();
  return { messages, attachments: await Promise.all(links.map(([u, n]) => attachOf(u, scrub(n)))) };
};

const section = (body: string, re: RegExp): string => {
  const parts = body.split(/^## /m).slice(1);
  const hit = parts.find((p) => re.test(p.split("\n")[0]));
  return hit ? hit.split("\n").slice(1).join("\n") : "";
};

// "1. Question? A) choice — consequence (recommended) B) choice" – options are optional
const parseQuestions = (body: string): Omit<Question, "answer">[] => {
  const sec = section(body, /ot[aá]zk/i);
  const qs: Omit<Question, "answer">[] = [];
  for (const l of sec.split("\n")) {
    const m = /^\s*(\d+)[.)]\s+(.+)$/.exec(l);
    if (!m) continue;
    const parts = m[2].split(/\s+(?=[A-D]\)\s)/);
    const text = scrub(parts[0].trim());
    const options = parts.slice(1).map((p): Opt => {
      const o = /^([A-D])\)\s*(.*)$/.exec(p.trim()) ?? [];
      const rec = /\(doporu[cč]uj[ui]\)/i.test(p);
      const [label, ...cons] = (o[2] ?? "").replace(/\(doporu[cč]uj[ui]\)/i, "").split(/\s+[—–]\s+/);
      return { key: o[1] ?? "", label: scrub(label.trim()), consequence: scrub(cons.join(" — ").trim()), recommended: rec };
    });
    qs.push({ id: m[1], text, options });
  }
  return qs;
};

const outcomeOf = (body: string): Card["outcome"] => {
  const rows: [string, string][] = [];
  for (const l of section(body, /shrnut[ií]|souhrn|z[aá]v[eě]r/i).split("\n")) {
    const c = l.split("|").map((x) => x.trim()).filter(Boolean);
    if (c.length >= 2 && !/^[-: ]+$/.test(c[0]) && !/^(video|téma|tema)$/i.test(c[0])) rows.push([scrub(c[0].replace(/\*/g, "")), scrub(c[1].replace(/\*/g, "")).slice(0, 220)]);
  }
  const lines = body.split("\n\n").map((p) => p.trim()).filter((p) => p && !/^[#|>\d!-]/.test(p)).slice(0, rows.length ? 0 : 3).map((p) => scrub(p.replace(/[*`]/g, "")).slice(0, 260));
  const media: [string, string][] = [...body.matchAll(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g)].map((m) => [m[2], m[1]]);
  return { lines, rows: rows.slice(0, 6), links: [], media: media.slice(0, 3) };
};

/* "what it's about": first 1–2 sentences of the description without markdown; the internal description is never passed off as the owner's own words */
const briefOf = (desc: string): string => {
  const p = desc.split("\n\n").map((x) => x.trim()).find((x) => x && !/^[#|>`]/.test(x)) ?? "";
  const plain = p.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`#>]/g, "").replace(/\s+/g, " ").trim();
  return scrub((plain.match(/^.+?[.!?](?:\s+.+?[.!?])?(?=\s|$)/)?.[0] ?? plain).slice(0, 300));
};

/* ---------- aggregating a single card ---------- */
export const card = async (identifier: string): Promise<Card | null> => {
  if (demoOn()) return demoCard(identifier);
  const issue = await pc<PIssue>(`/issues/${identifier}`);
  if (!issue) return null;
  const [parent, docs, comments, agent] = await Promise.all([
    issue.parentId ? pc<PIssue>(`/issues/${issue.parentId}`) : null,
    pc<{ key: string }[]>(`/issues/${issue.id}/documents`),
    pc<PComment[]>(`/issues/${issue.id}/comments?limit=20&order=desc`),
    issue.assigneeAgentId ? pc<{ name: string }>(`/agents/${issue.assigneeAgentId}`) : null,
  ]);
  const bodies: PDoc[] = (await Promise.all((docs ?? []).map((d) => pc<PDoc>(`/issues/${issue.id}/documents/${d.key}`)))).filter((d): d is PDoc => !!d);
  const zad = bodies.find((d) => d.key === "zadani");
  const work = bodies.filter((d) => d.key !== "zadani");

  // part 1: brief from the owner, otherwise the issue description
  let original: Card["original"];
  if (zad) original = { ...(await parseZadani(zad.body)), found: true, brief: "" };
  else original = { messages: [], attachments: [], found: false, brief: briefOf(issue.description ?? parent?.description ?? "") }; // the task description is for agents, not the owner's own words

  // parts 2 and 3: from agent documents (and from comments when a document is missing)
  const text = [...work.map((d) => d.body), ...(comments ?? []).filter((c) => c.authorType === "agent").map((c) => c.body)];
  const src = text.find((t) => /^## .*ot[aá]zk/im.test(t)) ?? "";
  const outcome = outcomeOf(work[0]?.body ?? text[0] ?? "");
  outcome.links = work.map((d) => [d.key, `${process.env.PAPERCLIP_ISSUE_URL ?? ""}/${issue.identifier}#document-${d.key}`]);
  const saved = new Map(sql().prepare("SELECT qid, value, at, sent FROM answers WHERE issue = ?").all(identifier).map((r) => [String(r.qid), r]));
  const questions: Question[] = parseQuestions(src).map((q) => {
    const a = saved.get(q.id);
    return a ? { ...q, answer: { value: String(a.value), at: String(a.at), sent: a.sent === 1 } } : q;
  });

  const owner = agent?.name ?? "CTO";
  const open = questions.filter((q) => !q.answer).length;
  const next = !questions.length
    ? { owner, text: `With ${owner}: ${issue.status === "blocked" ? "waiting on your decision" : "no open question"}`, stage: issue.status === "blocked" ? 0 : 1 }
    : open
      ? { owner, text: `Needs you: ${open} of ${questions.length} questions. Answers will go to ${owner}.`, stage: 0 }
      : { owner, text: writeOn() ? `Answers sent. ${owner} will assign the next work.` : "Draft answers saved, not sent (writing to Paperclip is disabled).", stage: writeOn() ? 2 : 0 };

  return {
    issue: issue.identifier, title: scrub(issue.title), kind: "Decision", url: `${process.env.PAPERCLIP_ISSUE_URL ?? ""}/${issue.identifier}`,
    lead: scrub((comments?.[0]?.body ?? issue.title).replace(/[*#`]/g, "")).slice(0, 220), write: writeOn(), original, outcome, questions, next,
  };
};

/* ---------- answer: a comment when PAPERCLIP_WRITE is set, otherwise just a draft in SQLite ---------- */
export const answer = async (issue: string, qid: string, value: string): Promise<{ sent: boolean }> => {
  const sent = writeOn();
  const clean = scrub(value.trim()).slice(0, 3000);
  if (sent) {
    const res = await fetch(`${base()}/issues/${issue}/comments`, {
      method: "POST", headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ body: `**The owner (via BMQOS) – answer to question ${qid}:** ${clean}` }), signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`Paperclip ${res.status}`);
  }
  sql().prepare("INSERT OR REPLACE INTO answers VALUES (?,?,?,?,?)").run(issue, qid, clean, new Date().toISOString(), sent ? 1 : 0);
  return { sent };
};
/* ---------- PR for a merge task: server reads the repo/number from the issue, never from the client ---------- */
export const prOf = async (identifier: string): Promise<{ repo: string; n: number; judge: ReturnType<typeof judgeOf> } | null> => {
  const issue = await pc<PIssue>(`/issues/${identifier}`);
  if (!issue) return null;
  const comments = (await pc<PComment[]>(`/issues/${issue.id}/comments?limit=20&order=desc`)) ?? [];
  const m = [...comments.map((c) => c.body), issue.description ?? ""].flatMap((t) => [...t.matchAll(PR_URL)])[0];
  return m ? { repo: m[1], n: Number(m[2]), judge: judgeOf(comments) } : null;
};

export const note = async (issue: string, body: string): Promise<void> => {
  if (!writeOn()) return;
  await fetch(`${base()}/issues/${issue}/comments`, { method: "POST", headers: { ...auth(), "Content-Type": "application/json" }, body: JSON.stringify({ body }), signal: AbortSignal.timeout(20_000) }).catch(() => null);
};
