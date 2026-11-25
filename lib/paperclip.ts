import "server-only";
import { REAL, realOf } from "./projects";
import { ago, dayKey, dayLbl, dur, hm, hmd, oneLine, tok } from "./format";
import { servers } from "./servers";
import { demoOn, demoSnapshot } from "./demo";
import { simulate, simStatus } from "./simulator";
import type { Agent, AgentState, FeedRow, FlowNode, Kind, Snapshot, Wait } from "./types";

/* ---------- app config: abbreviations and ring order (work order) ---------- */
const RING: [string, string][] = [
  ["Hermes", "HM"], ["CTO", "CT"], ["Strategist", "ST"], ["Designer", "DS"], ["Engineer 1", "E1"],
  ["Engineer 2", "E2"], ["Engineer 3", "E3"], ["Junior Haiku", "JH"], ["Junior Antigravity", "JA"],
  ["Visual Critic", "VC"], ["QA", "QA"], ["Code Reviewer", "CR"], ["Security", "SE"], ["Critic", "CI"],
  ["Defender", "DF"], ["Judge", "JU"], ["Release Manager", "RM"],
];
const ROLE_CZ: Record<string, string> = {
  Hermes: "CEO", CTO: "CTO · plans and assigns", Strategist: "Strategy", Designer: "UI design before code",
  "Engineer 1": "Build", "Engineer 2": "Build", "Engineer 3": "Build", "Junior Haiku": "Simple tasks",
  "Junior Antigravity": "Simple tasks (Gemini)", "Visual Critic": "UI gate ≥ 7.5", QA: "Browser testing",
  "Code Reviewer": "Code review", Security: "Security", Critic: "Critiques plans and PRs", Defender: "Defense",
  Judge: "Referee", "Release Manager": "Summary for the owner",
};
const PHASES: { n: string; ag: string; who: string[] }[] = [
  { n: "Assignment", ag: "CTO · Hermes", who: ["CTO", "Hermes"] },
  { n: "Design", ag: "Designer", who: ["Designer"] },
  { n: "Build", ag: "Engineer 1–3 · Juniors", who: ["Engineer 1", "Engineer 2", "Engineer 3", "Junior Haiku", "Junior Antigravity"] },
  { n: "Visual gate", ag: "Visual Critic", who: ["Visual Critic"] },
  { n: "Review", ag: "QA · Code Review · Security", who: ["QA", "Code Reviewer", "Security"] },
  { n: "Dispute", ag: "Critic → Defender → Judge", who: ["Critic", "Defender", "Judge"] },
];
const USD_PER_MTOK = Number(process.env.OS_USD_PER_MTOK ?? "5");

/* ---------- shape of Paperclip API responses (only the fields we read) ---------- */
interface PAgent { id: string; name: string; role: string; status: string; adapterType: string; lastHeartbeatAt: string | null }
/** Task waits for a human: in_review, or blocked with no blocking tasks. Shared by Home and Tasks. */
export const waitsHuman = (i: { status: string; blockerAttention?: { state: string; unresolvedBlockerCount: number } | null }): boolean =>
  i.status === "in_review" || (i.status === "blocked" && i.blockerAttention?.state === "needs_attention" && !i.blockerAttention.unresolvedBlockerCount);
interface PIssue {
  id: string; identifier: string; title: string; status: string; projectId: string | null; assigneeAgentId: string | null;
  assigneeUserId: string | null; updatedAt: string; completedAt: string | null; description?: string | null;
  activeRun?: { status: string } | null; blockerAttention?: { state: string; unresolvedBlockerCount: number } | null;
}
interface PRun {
  id: string; agentId: string; issueId: string | null; status: string; inputTokens: number | string | null; outputTokens: number | string | null;
  startedAt: string | null; finishedAt: string | null; error: string | null; stderrExcerpt: string | null; errorCode: string | null;
}
interface PComment { authorAgentId: string | null; body: string; createdAt: string }
interface PProject { id: string; name: string }

const base = (): string => process.env.PAPERCLIP_API_URL ?? "";
// Paperclip is optional: without PAPERCLIP_API_URL reads return empty lists (use the bundled Crew engine instead)
export const paperclipOn = (): boolean => !!process.env.PAPERCLIP_API_URL;
const raw = async <T>(path: string): Promise<T> => {
  if (!paperclipOn()) return [] as unknown as T;
  const res = await fetch(`${base()}${path}`, {
    headers: { Authorization: `Bearer ${process.env.PAPERCLIP_API_TOKEN ?? ""}` },
    cache: "no-store",
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`Paperclip ${res.status} ${path}`);
  return (await res.json()) as T;
};

// heavy lists aren't refetched on every client request (spec: overview 5 s, issues 30 s)
const memo = new Map<string, { at: number; v: Promise<unknown> }>();
const get = <T>(path: string, ttl = 5000): Promise<T> => {
  const hit = memo.get(path);
  if (hit && Date.now() - hit.at < ttl) return hit.v as Promise<T>;
  const v = raw<T>(path);
  memo.set(path, { at: Date.now(), v });
  v.catch(() => memo.delete(path));
  return v;
};

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const tokensOf = (r: PRun): number => Number(r.inputTokens ?? 0) + Number(r.outputTokens ?? 0);
const durOf = (r: PRun): number => (r.startedAt && r.finishedAt ? Date.parse(r.finishedAt) - Date.parse(r.startedAt) : 0);
const shortName = (n: string): string => {
  if (/Piñata/i.test(n)) return "Piñata";
  if (/Mission/i.test(n)) return "Mission C.";
  if (/\bAds\b/i.test(n)) return "Ads";
  return n.replace(/^acme\s+/i, "").split(/[\s(&+]/)[0].slice(0, 11) || n;
};
const kindOf = (i: PIssue): Kind => {
  if (/\bPR\b|merge/i.test(i.title)) return "PR to merge";
  if (/approv/i.test(i.title)) return "Approval";
  if (i.title.includes("?")) return "Question";
  return "Decision";
};

const commentCache = new Map<string, { at: number; v: PComment[] }>();
const commentsOf = async (id: string): Promise<PComment[]> => {
  const hit = commentCache.get(id);
  if (hit && Date.now() - hit.at < 60_000) return hit.v;
  const v = await get<PComment[]>(`/issues/${id}/comments?limit=3&order=desc`).catch(() => []);
  commentCache.set(id, { at: Date.now(), v });
  return v;
};

// stale-while-revalidate: the client gets the last data immediately, refresh runs in the background
let last: Snapshot | null = null;
let pending: Promise<Snapshot> | null = null;
let lastAt = 0;
let failing = false;
export const snapshot = async (): Promise<Snapshot> => {
  if (demoOn()) { const s = simStatus(), d = demoSnapshot(); return s.on ? { ...simulate(d, s.t), sim: true } : { ...d, sim: false }; }
  if (!pending && Date.now() - lastAt >= 4000) {
    pending = build()
      .then((v) => { last = v; lastAt = Date.now(); failing = false; return v; })
      .catch((e: unknown) => { failing = true; lastAt = Date.now(); throw e; })
      .finally(() => { pending = null; });
    pending.catch(() => undefined);
  }
  if (last) return { ...last, ok: !failing };
  return (pending as Promise<Snapshot>);
};

const build = async (): Promise<Snapshot> => {
  const C = process.env.PAPERCLIP_COMPANY_ID ?? "";
  const [pa, issues, runs, pp, srv] = await Promise.all([
    get<PAgent[]>(`/companies/${C}/agents`),
    get<PIssue[]>(`/companies/${C}/issues?limit=1000`, 30_000),
    get<PRun[]>(`/companies/${C}/heartbeat-runs?limit=600`, 10_000),
    get<PProject[]>(`/companies/${C}/projects`, 300_000),
    servers(),
  ]);
  const now = Date.now();
  const today = dayKey(new Date(now).toISOString());
  const byId = new Map(issues.map((i) => [i.id, i]));
  const ident = (id: string | null): string => (id ? byId.get(id)?.identifier ?? "" : "");
  const projOf = (i: PIssue | undefined): string => i?.projectId ?? "other";

  /* agents – ring order from config, unknown ones go last */
  const rank = (n: string): number => { const k = RING.findIndex(([x]) => x === n); return k < 0 ? 99 : k; };
  const sorted = [...pa].sort((a, b) => rank(a.name) - rank(b.name));
  const finished = runs.filter((r) => r.startedAt && (r.status === "succeeded" || r.status === "failed"));
  const todayRuns = runs.filter((r) => r.startedAt && dayKey(r.startedAt) === today && ["succeeded", "failed", "running"].includes(r.status));
  const runMsg = (r: PRun): string => oneLine(r.error ?? r.stderrExcerpt ?? r.errorCode ?? "error with no description", 120);
  const dayList = [...new Set(runs.filter((r) => r.startedAt).map((r) => dayKey(r.startedAt as string)))].sort().slice(-14);
  if (!dayList.includes(today)) dayList.push(today);

  const agents: Agent[] = sorted.map((a) => {
    const mine = runs.filter((r) => r.agentId === a.id && r.startedAt);
    const tr = todayRuns.filter((r) => r.agentId === a.id);
    const done = tr.filter((r) => r.status !== "running");
    const curIssue = issues.find((i) => i.assigneeAgentId === a.id && i.status === "in_progress");
    const lastIssue = byId.get(mine.find((r) => r.issueId)?.issueId ?? "");
    const failed = mine.find((r) => r.status === "failed");
    const st: AgentState = a.status === "running" || a.status === "paused" || a.status === "error" ? a.status : "idle";
    return {
      id: a.id, n: a.name, s: RING.find(([x]) => x === a.name)?.[1] ?? a.name.slice(0, 2).toUpperCase(),
      role: ROLE_CZ[a.name] ?? a.role, st, pr: projOf(curIssue ?? lastIssue), adapter: a.adapterType,
      hb: a.lastHeartbeatAt ? `${ago((now - Date.parse(a.lastHeartbeatAt)) / 60000)} ago` : "never",
      tokN: tr.reduce((s, r) => s + tokensOf(r), 0), tok: tok(tr.reduce((s, r) => s + tokensOf(r), 0)),
      runs: tr.length, ok: done.length ? Math.round((done.filter((r) => r.status === "succeeded").length / done.length) * 100) : 0,
      cur: curIssue?.identifier, curT: curIssue && oneLine(curIssue.title, 90), since: runs.find((r) => r.agentId === a.id && r.status === "running" && r.startedAt)?.startedAt ? hm(runs.find((r) => r.agentId === a.id && r.status === "running")?.startedAt as string) : undefined, err: st === "error" && failed ? runMsg(failed) : undefined,
      spark: dayList.map((d) => mine.filter((r) => dayKey(r.startedAt as string) === d).reduce((s, r) => s + tokensOf(r), 0)),
    };
  });
  const agName = new Map(agents.map((a) => [a.id, a]));

  /* waits for the owner = in_review, or blocked with no blocking tasks (waits for a human); no agent running */
  const waitIssues = issues
    .filter((i) => waitsHuman(i) && i.activeRun?.status !== "running")
    .sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt));
  const cms = new Map<string, PComment[]>(await Promise.all(waitIssues.map(async (i) => [i.id, await commentsOf(i.id)] as const)));
  const wait: Wait[] = waitIssues.map((i) => {
    const mine = runs.filter((r) => r.issueId === i.id);
    const c = cms.get(i.id) ?? [];
    const ageMin = (now - Date.parse(i.updatedAt)) / 60000;
    return {
      id: i.identifier, t: oneLine(i.title, 160), kind: kindOf(i), st: i.status, age: ago(ageMin), ageMin,
      pr: projOf(i), ag: i.assigneeAgentId ?? "", runs: mine.length, tok: tok(mine.reduce((s, r) => s + tokensOf(r), 0)),
      why: oneLine(c[0]?.body ?? i.description ?? "No description.", 260),
      cm: c.map((x): [string, string, string] => [hmd(x.createdAt), agName.get(x.authorAgentId ?? "")?.n ?? "owner", oneLine(x.body, 200)]),
      url: `${process.env.PAPERCLIP_ISSUE_URL ?? ""}/${i.identifier}`,
    };
  });

  /* projects */
  const open = (i: PIssue): boolean => ["todo", "in_progress", "in_review", "blocked"].includes(i.status);
  const names = new Map(pp.map((p) => [p.id, p.name]));
  names.set("other", "Other");
  const waitIds = new Set(waitIssues.map((i) => i.id));
  const projects = [...names].map(([id, n]) => {
    const is = issues.filter((i) => projOf(i) === id);
    return {
      id, n, short: shortName(n), you: is.filter((i) => waitIds.has(i.id)).length,
      open: is.filter((i) => open(i) && !waitIds.has(i.id)).length, tot: is.filter((i) => i.status === "done").length,
    };
  }).filter((p) => p.open + p.you + p.tot > 0);
  const pname = new Map(pp.map((p) => [p.id, p.name]));
  const live = issues.filter((i) => open(i) || i.status === "done");
  const group = (i: PIssue): { key: string; n: string; url: string } => {
    const pn = (i.projectId && pname.get(i.projectId)) || "Company";
    const r = realOf(i.title, pn);
    return r ? { key: r.n, n: r.n, url: r.url } : { key: `pc:${pn}`, n: shortName(pn), url: "" };
  };
  const groups = new Map<string, { n: string; url: string; is: PIssue[] }>(REAL.map((r) => [r.n, { n: r.n, url: r.url, is: [] }]));
  for (const i of live) { const g = group(i); (groups.get(g.key) ?? groups.set(g.key, { n: g.n, url: g.url, is: [] }).get(g.key))?.is.push(i); }
  const clean = (t: string): string => oneLine(t.replace(/^[^:·]{0,40}[·:]\s*/, "").replace(/^[A-Z]{2,6}-\d+\s*[:·-]?\s*/, "") || t, 110);
  const ventures = [...groups.values()].map((g) => {
    const run = g.is.filter((i) => i.status === "in_progress").sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
    const dn = g.is.filter((i) => i.status === "done").sort((a, b) => Date.parse(b.completedAt ?? b.updatedAt) - Date.parse(a.completedAt ?? a.updatedAt))[0];
    return {
      n: g.n, url: g.url, you: g.is.filter((i) => waitIds.has(i.id)).length,
      open: g.is.filter((i) => open(i) && !waitIds.has(i.id)).length,
      now: run ? `Now: ${clean(run.title)}` : dn ? `Last done: ${clean(dn.title)}` : "No tasks yet.",
    };
  }).filter((p) => p.open + p.you > 0 || p.now !== "No tasks yet." || REAL.some((r) => r.n === p.n));

  /* feed + monitor */
  const feed: FeedRow[] = runs
    .filter((r) => r.startedAt && ["succeeded", "failed", "running"].includes(r.status))
    .slice(0, 9)
    .map((r) => ({
      t: hm(r.startedAt as string), a: agName.get(r.agentId)?.n ?? "?", aid: r.agentId, i: ident(r.issueId),
      r: r.status === "running" ? "running" : r.status === "failed" ? "error" : "ok",
      s: r.status === "running" ? "run" : r.status === "failed" ? "er" : "ok",
      d: dur(r.status === "running" ? now - Date.parse(r.startedAt as string) : durOf(r)), k: r.status === "running" ? "—" : tok(tokensOf(r)),
    }));
  const recent = issues.filter((i) => open(i) && i.assigneeAgentId).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, 8);
  const rc = await Promise.all(recent.map(async (i) => ({ i, c: (await commentsOf(i.id))[0] })));
  const lastComments = rc.filter((x) => x.c?.authorAgentId).sort((a, b) => Date.parse(b.c.createdAt) - Date.parse(a.c.createdAt));
  const talk = lastComments
    .filter((x) => x.c.authorAgentId !== x.i.assigneeAgentId)
    .slice(0, 4)
    .map((x): [string, string, string] => [agName.get(x.c.authorAgentId ?? "")?.n ?? "?", agName.get(x.i.assigneeAgentId ?? "")?.n ?? "?", `${x.i.identifier} · ${oneLine(x.c.body, 60)}`]);
  const comments = lastComments.slice(0, 3).map((x) => ({ t: hmd(x.c.createdAt), a: agName.get(x.c.authorAgentId ?? "")?.n ?? "?", text: `${x.i.identifier} · ${oneLine(x.c.body, 70)}` }));

  /* work flow */
  const phaseOf = (i: PIssue): number => {
    const n = agName.get(i.assigneeAgentId ?? "")?.n ?? "";
    return PHASES.findIndex((p) => p.who.includes(n));
  };
  const flow: FlowNode[] = PHASES.map((p, k): FlowNode => {
    const ids = issues.filter((i) => ["todo", "in_progress", "blocked"].includes(i.status) && !waitIds.has(i.id) && phaseOf(i) === k);
    const who = new Set(agents.filter((a) => p.who.includes(a.n)).map((a) => a.id));
    const med = median(finished.filter((r) => who.has(r.agentId) && now - Date.parse(r.startedAt as string) < 7 * 864e5).map(durOf));
    const chips = ids.map((i) => i.identifier);
    return {
      n: p.n, ag: p.ag, c: ids.length, w: med ? `ø ${med >= 3600e3 ? `${Math.floor(med / 3600e3)} h ${Math.round((med % 3600e3) / 60e3)}` : `${Math.max(1, Math.round(med / 60e3))} min`}` : "—",
      iss: chips.length > 5 ? [...chips.slice(0, 5), `+${chips.length - 5}`] : chips,
      on: agents.some((a) => who.has(a.id) && a.st === "running"),
    };
  });
  flow.push({
    n: "Needs you", ag: "merge · decisions · questions", c: wait.length, w: wait.length ? `avg ${ago(median(wait.map((w) => w.ageMin)))}` : "—",
    iss: wait.length > 3 ? [...wait.slice(0, 3).map((w) => w.id), `+${wait.length - 3}`] : wait.map((w) => w.id), you: true,
  });
  const doneRecent = issues.filter((i) => i.status === "done" && i.completedAt && now - Date.parse(i.completedAt) < 864e5);
  const feedHours = Array.from({ length: 24 }, (_, h) => doneRecent.filter((i) => Math.floor((now - Date.parse(i.completedAt as string)) / 36e5) === 23 - h).length);

  /* runs and costs */
  const days = dayList.map((d) => ({ lbl: d === today ? "today" : dayLbl(d), v: runs.filter((r) => r.startedAt && dayKey(r.startedAt) === d).reduce((s, r) => s + tokensOf(r), 0) }));
  const tokTodayN = days[days.length - 1].v;
  const prev = days.slice(0, -1).filter((d) => d.v > 0);
  const avg = prev.length ? prev.reduce((s, d) => s + d.v, 0) / prev.length : 0;
  const fin = todayRuns.filter((r) => r.status !== "running");
  const ds = fin.map(durOf);
  const errors = todayRuns.filter((r) => r.status === "failed").slice(0, 3)
    .map((r) => ({ t: hm(r.startedAt as string), a: agName.get(r.agentId)?.n ?? "?", i: ident(r.issueId), msg: runMsg(r) }));

  return {
    at: new Date(now).toISOString(),
    clock: new Date(now).toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Prague" }),
    date: new Date(now).toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric", timeZone: "Europe/Prague" }),
    ok: true, control: process.env.OS_CONTROL === "1", servers: srv, projects, ventures, agents, wait, feed, talk, flow, feedHours, done24: doneRecent.length, days,
    tokToday: tok(tokTodayN), tokTodayN, tokAvgPct: avg ? Math.round((tokTodayN / avg) * 100) : 0,
    usd: `≈ $${Math.round((tokTodayN / 1e6) * USD_PER_MTOK)}`,
    kpi: {
      runs: todayRuns.length, running: todayRuns.filter((r) => r.status === "running").length,
      okPct: fin.length ? Math.round((fin.filter((r) => r.status === "succeeded").length / fin.length) * 100) : 0,
      failed: fin.filter((r) => r.status === "failed").length, avg: dur(ds.length ? ds.reduce((s, x) => s + x, 0) / ds.length : 0), longest: dur(Math.max(0, ...ds)),
    },
    errors, comments,
    waitOldest: wait.length ? ago(Math.max(...wait.map((w) => w.ageMin))) : "",
  };
};

/* ---------- read for the "item" model (lib/items.ts) and handing a task to Hermes ---------- */
export interface TaskRow {
  identifier: string; title: string; status: string; project: string; agent: string | null;
  assigneeUser: boolean; waitsHuman: boolean; running: boolean; at: string;
  /** text of the open card with questions for the owner (interaction ask_user_questions / request_*), otherwise null */
  ask: string | null;
  /** first question from the card and count of the rest (for the Home card) */
  q: string | null; more: number;
  /** owner wrote "not yet" after the card was created → deferred */
  deferred: boolean;
}
interface PInteraction { kind: string; status: string; title?: string | null; summary?: string | null; createdAt: string; payload?: { questions?: { prompt?: string }[] } }
const ASKS = /^(ask_user_questions|request_\w+)$/;
const LATER = /\bnot yet\b|\bzat[ií]m ne\b|\bne te[dď]/i;
// card text when Paperclip didn't respond: the task stays in Needs you (ask ≠ null), not "no card"
const UNKNOWN_ASK = "card could not load (API error)";
// Technical confirmations (push, PR, merge, deploy, guard, branch) and cards with no text at all are handled by Hermes, not the owner:
// the owner in BMQOS only sees questions they can answer, and never has to go into Paperclip.
const TECH = /\b(push|pr|pull request|merge|deploy|deploy(ed|ing)?|guard|branch|hook|ci|build)\b/i;
const forHermes = (x: PInteraction): boolean => {
  const ps = [x.title, x.summary, ...(x.payload?.questions ?? []).map((q) => q.prompt)].filter((p): p is string => !!p && !!p.trim());
  if (!ps.length) return true;
  if (x.kind === "request_confirmation" && ps.some((p) => TECH.test(p))) return true;
  return ps.every((p) => /^\s*(\*\*)?(hermes|ceo)\b/i.test(p));
};
// open card for the owner: pending interaction; deferred = a later human comment with "not yet" etc.
// an API error must never mean "no card" – on failure it returns UNKNOWN_ASK, so the task stays with the owner.
export const askOf = async (id: string): Promise<{ ask: string | null; q: string | null; more: number; deferred: boolean }> => {
  const xs = await get<PInteraction[]>(`/issues/${id}/interactions`, 30_000).then(
    // questions addressed to Hermes (CEO) aren't the owner's – agents write "Hermes: …" for those
    (r) => r.filter((x) => ASKS.test(x.kind) && x.status === "pending" && !forHermes(x)),
    (e: unknown) => { console.warn(`askOf ${id}: interactions`, e); return null; },
  );
  if (xs === null) return { ask: UNKNOWN_ASK, q: null, more: 0, deferred: false };
  if (!xs.length) return { ask: null, q: null, more: 0, deferred: false };
  const since = Math.max(...xs.map((x) => Date.parse(x.createdAt)));
  const cs = await get<{ authorType: string; body: string; createdAt: string }[]>(`/issues/${id}/comments?order=desc&limit=10`, 30_000).then(
    (r) => r,
    (e: unknown) => { console.warn(`askOf ${id}: comments`, e); return []; },
  );
  const ask = xs.map((x) => [x.title, x.summary, ...(x.payload?.questions ?? []).map((q) => q.prompt)].filter(Boolean).join(" ")).join(" ");
  const qs = xs.flatMap((x) => (x.payload?.questions ?? []).map((q) => q.prompt).filter((p): p is string => !!p));
  const all = qs.length ? qs : xs.map((x) => x.title || x.summary).filter((p): p is string => !!p);
  return { ask, q: all[0] ?? null, more: Math.max(0, all.length - 1), deferred: cs.some((c) => c.authorType === "user" && Date.parse(c.createdAt) > since && LATER.test(c.body)) };
};
// open tasks + done in the last 7 days; "waits for a human" = in_review, or blocked with no blocking tasks (same as build())
export const taskRows = async (): Promise<TaskRow[]> => {
  const C = process.env.PAPERCLIP_COMPANY_ID ?? "";
  const [pa, issues, pp] = await Promise.all([
    get<PAgent[]>(`/companies/${C}/agents`, 60_000),
    get<PIssue[]>(`/companies/${C}/issues?limit=1000`, 30_000),
    get<PProject[]>(`/companies/${C}/projects`, 300_000),
  ]);
  const agent = new Map(pa.map((a) => [a.id, a.name]));
  const proj = new Map(pp.map((p) => [p.id, shortName(p.name)]));
  const week = Date.now() - 7 * 864e5;
  const rows = issues.filter((i) => ["todo", "in_progress", "in_review", "blocked"].includes(i.status) || (i.status === "done" && Date.parse(i.completedAt ?? i.updatedAt) > week));
  const asks = new Map<string, Awaited<ReturnType<typeof askOf>>>();
  const open = rows.filter((i) => i.status !== "done");
  for (let k = 0; k < open.length; k += 8) await Promise.all(open.slice(k, k + 8).map(async (i) => { asks.set(i.identifier, await askOf(i.identifier)); }));
  return rows
    .map((i) => ({
      ...(asks.get(i.identifier) ?? { ask: null, q: null, more: 0, deferred: false }),
      identifier: i.identifier, title: i.title, status: i.status, project: (i.projectId && proj.get(i.projectId)) || "Company",
      agent: i.assigneeAgentId ? agent.get(i.assigneeAgentId) ?? null : null, assigneeUser: !!i.assigneeUserId,
      waitsHuman: waitsHuman(i),
      running: i.activeRun?.status === "running", at: i.updatedAt,
    }));
};

// new task for an agent by name (hands off to Hermes); returns the identifier
export const createIssueFor = async (name: string, title: string, description: string): Promise<string> => {
  const C = process.env.PAPERCLIP_COMPANY_ID ?? "";
  const pa = await get<PAgent[]>(`/companies/${C}/agents`, 60_000);
  const a = pa.find((x) => x.name === name);
  if (!a) throw new Error(`agent ${name} not found`);
  const res = await fetch(`${base()}/companies/${C}/issues`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.PAPERCLIP_API_TOKEN ?? ""}`, "Content-Type": "application/json" },
    body: JSON.stringify({ title, description, assigneeAgentId: a.id, status: "todo" }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Paperclip ${res.status}`);
  return ((await res.json()) as { identifier: string }).identifier;
};

/* ---------- for the New Task module: cached reads and writes ---------- */
export const company = (): string => process.env.PAPERCLIP_COMPANY_ID ?? "";
export const pcGet = get;
export const pcSend = async <T>(method: "POST" | "PUT" | "PATCH", path: string, body: unknown): Promise<T> => {
  const res = await fetch(`${base()}${path}`, {
    method,
    headers: { Authorization: `Bearer ${process.env.PAPERCLIP_API_TOKEN ?? ""}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Paperclip ${res.status}`);
  return (await res.json()) as T;
};
