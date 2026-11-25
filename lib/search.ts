import "server-only";
import { snapshot } from "./paperclip";
import { servers } from "./servers";
import { SECS } from "@/components/shell";

/* ⌘K: one search across tasks, agents, projects, services (name/IP/domain), docs and PRs + command recognition.
   The server only returns WHAT would be called (act); the client's module APIs handle the write (they enforce OS_CONTROL, proposal, step-up). */
export type Kind = "section" | "act" | "task" | "agent" | "project" | "service" | "pr";
export interface Act { url: string; body: object; ok: string; sure: boolean; go?: string }
export interface Hit { k: Kind; id: string; t: string; s: string; h?: string; ext?: string; act?: Act }

const norm = (s: string): string => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
/* every word of the query must be in the text; the earlier and the more at a word's start, the higher it ranks */
const score = (q: string[], text: string): number => {
  const h = norm(text);
  let sc = 0;
  for (const w of q) {
    const i = h.indexOf(w);
    if (i < 0) return 0;
    sc += i === 0 ? 3 : h[i - 1] === " " || h[i - 1] === "-" ? 2 : 1;
  }
  return sc;
};
const rank = <T>(q: string[], rows: T[], text: (r: T) => string, max: number): T[] =>
  rows.map((r) => ({ r, sc: score(q, text(r)) })).filter((x) => x.sc).sort((a, b) => b.sc - a.sc).slice(0, max).map((x) => x.r);

interface Pr { repo: string; n: number; title: string; url: string }
let prs: { at: number; v: Pr[] } | null = null;
/* open PRs in allowed repos (GitHub token lives only here on the server); empty without a token */
const openPrs = async (): Promise<Pr[]> => {
  if (prs && Date.now() - prs.at < 60_000) return prs.v;
  const token = process.env.GITHUB_TOKEN;
  const repos = (process.env.OS_ALLOWED_REPOS ?? "").split(",").map((s) => s.trim()).filter((r) => /^[\w.-]+\/[\w.-]+$/.test(r));
  if (!token || !repos.length) return [];
  const v = (await Promise.all(repos.map(async (repo) => {
    const res = await fetch(`${process.env.GITHUB_API_URL ?? "https://api.github.com"}/repos/${repo}/pulls?state=open&per_page=30`, {
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(8000),
    }).catch(() => null);
    const j = res?.ok ? ((await res.json().catch(() => [])) as { number: number; title: string; html_url: string }[]) : [];
    return j.map((p): Pr => ({ repo, n: p.number, title: p.title, url: p.html_url }));
  }))).flat();
  prs = { at: Date.now(), v };
  return v;
};

const CMD = /^(pause|stop|resume|continue|wake|wakeup|new task|task|ask assistant|assistant|redeploy|deploy|restart)\s*(.*)$/i;

export const search = async (raw: string): Promise<Hit[]> => {
  const text = raw.trim().slice(0, 200);
  if (!text) return [];
  const q = norm(text).split(/\s+/).filter(Boolean);
  const cmd = CMD.exec(text);
    const [snap, svc, pr] = await Promise.all([snapshot(), servers(), openPrs()]);
  const out: Hit[] = [];

  if (cmd) {
    const verb = norm(cmd[1]), arg = cmd[2].trim(), aq = norm(arg).split(/\s+/).filter(Boolean);
    if (/^(pause|stop|resume|continue|wake|wakeup)$/.test(verb)) {
      const value = verb === "pause" || verb === "stop" ? "pause" : verb.startsWith("wake") ? "wakeup" : "resume";
      // without an agent name, offer the ones where the action makes sense (running / paused)
      for (const a of aq.length ? rank(aq, snap.agents, (x) => `${x.n} ${x.role}`, 4) : snap.agents.filter((x) => (value === "pause" ? x.st === "running" : value === "resume" ? x.st === "paused" : x.st !== "running")).slice(0, 4))
        out.push({ k: "act", id: `${value}:${a.id}`, t: `${{ pause: "Pause", wakeup: "Wake", resume: "Resume" }[value]} ${a.n}`, s: a.role, act: { url: "/api/act", body: { op: "agent", id: a.id, value }, ok: "Done", sure: false } });
    } else if (/^(new task|task)$/.test(verb) && arg) {
      out.push({ k: "act", id: "task", t: `New task: ${arg}`, s: "Assistant will break it down and assign it", act: { url: "/api/chat", body: { text: `New task: ${arg}` }, ok: "Sent to Assistant", sure: false, go: "hermes" } });
    } else if (/^(ask assistant|assistant)$/.test(verb) && arg) {
      out.push({ k: "act", id: "hermes", t: `Ask Assistant: ${arg}`, s: "Opens chat with the answer", act: { url: "/api/chat", body: { text: arg }, ok: "Sent to Assistant", sure: false, go: "hermes" } });
    } else if (/^(redeploy|deploy)$/.test(verb)) {
      for (const p of rank(aq, snap.projects, (x) => `${x.n} ${x.short}`, 4))
        out.push({ k: "act", id: `deploy:${p.id}`, t: `Redeploy ${p.n}`, s: "Via the Deploy module (proposal / confirmation)", act: { url: "/api/deploy/deploys", body: { app: p.short, redeploy: true }, ok: "Redeploy handed to the Deploy module", sure: true } });
    } else if (verb === "restart") {
      for (const x of rank(aq, svc, (s) => `${s.n} ${s.target}`, 4))
        out.push({ k: "act", id: `restart:${x.n}`, t: `Restart ${x.n}`, s: `${x.where} · ${x.target}`, act: { url: "/api/services/restart", body: { service: x.n }, ok: "Restart handed to the Services module", sure: true } });
    }
  }

  const rows = verbless(cmd, q);
  if (!cmd) for (const x of rank(q, SECS.flatMap((c) => [{ r: c.r, t: c.n, s: c.hint }, ...(c.subs ?? []).map((u) => ({ r: u.r, t: u.n, s: `${c.n} · subpage` }))]).concat([{ r: "settings", t: "Notifications", s: "Push and desktop app" }]), (x) => `${x.t} ${x.s}`, 4)) out.push({ k: "section", id: x.r, t: x.t, s: x.s, h: x.r });
  for (const a of rank(rows, snap.agents, (x) => `${x.n} ${x.role} ${x.cur ?? ""}`, 5)) out.push({ k: "agent", id: a.id, t: a.n, s: `${a.role} · ${a.st}`, h: `agents&agent=${a.id}` });
  for (const p of rank(rows, snap.projects, (x) => `${x.n} ${x.short}`, 4)) out.push({ k: "project", id: p.id, t: p.n, s: `${p.open} open`, h: "overview" });
  const tasks = new Map<string, { id: string; t: string; s: string }>();
  for (const w of snap.wait) tasks.set(w.id, { id: w.id, t: w.t, s: `needs you · ${w.kind}` });
  for (const n of snap.flow) for (const i of n.iss) if (!tasks.has(i)) tasks.set(i, { id: i, t: "", s: `${n.n} · ${n.ag}` });
  for (const t of rank(rows, [...tasks.values()], (x) => `${x.id} ${x.t}`, 6)) out.push({ k: "task", id: t.id, t: `${t.id} ${t.t}`.trim(), s: t.s, h: `flow&issue=${t.id}` });
  for (const s of rank(rows, svc, (x) => `${x.n} ${x.where} ${x.target}`, 5)) out.push({ k: "service", id: s.n, t: s.n, s: `${s.up ? "running" : "unavailable"} · ${s.target}`, h: "servers" });
  for (const p of rank(rows, pr, (x) => `${x.repo} ${x.n} ${x.title}`, 5)) out.push({ k: "pr", id: `${p.repo}#${p.n}`, t: p.title, s: `${p.repo} #${p.n}`, ext: p.url });
  return out;
};

/* after a recognized command, search only by the argument (without the verb) */
const verbless = (cmd: RegExpExecArray | null, q: string[]): string[] => (cmd && cmd[2].trim() ? norm(cmd[2]).split(/\s+/).filter(Boolean) : q);
