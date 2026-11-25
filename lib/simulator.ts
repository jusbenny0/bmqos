import type { Snapshot, FeedRow, Wait } from "./types";
import type { TeamMember, Task } from "./crew";

// Demo simulator: replays one CEO task through the team on a fixed 40 s loop. Pure and deterministic:
// the same elapsed time always gives the same snapshot. Demo data only, no backend involved.
export const LOOP = 40;
const TITLE = "Add CSV export to reports";

// at/end = seconds of the loop, who = agent index (wraps if the team is smaller), tok = tokens burned per second
const STEPS = [
  { at: 0, end: 7, who: 0, txt: "Splitting the CEO request into 3 tasks", id: "SIM-1", tok: 1400, talk: ["CEO", "Planner", "New request: add CSV export to reports."] },
  { at: 7, end: 26, who: 1, txt: "Building the export endpoint", id: "SIM-2", tok: 2600, talk: ["Planner", "Builder 1", "Endpoint first, spec is in SIM-2."] },
  { at: 7, end: 20, who: 2, txt: "Building the download button", id: "SIM-3", tok: 2200, talk: ["Planner", "Builder 2", "Button and file name, spec in SIM-3."] },
  { at: 20, end: 26, who: 3, txt: "Visual check at 1440 and 390 px", id: "SIM-3", tok: 1500, talk: ["Builder 2", "Visual bar", "Button is ready, please check the layout."] },
  { at: 26, end: 33, who: 4, txt: "Reviewing the pull request", id: "SIM-2", tok: 2000, talk: ["Builder 1", "Reviewer", "PR is up, tests are green."] },
  { at: 33, end: 38, who: 5, txt: "Smoke test in the browser", id: "SIM-1", tok: 1200, talk: ["Reviewer", "QA", "Approved, run the smoke test."] },
] as const;

const fmt = (n: number): string => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : `${Math.round(n / 1000)}k`);
const clock = (s: number): string => `10:${String(40 + Math.floor(s / 60)).padStart(2, "0")}`;

export const simulate = (base: Snapshot, elapsed: number): Snapshot => {
  const t = elapsed % LOOP;
  const loops = Math.floor(elapsed / LOOP);
  const idx = (w: number): number => w % base.agents.length;
  const active = STEPS.map((s) => t >= s.at && t < s.end);
  const done = STEPS.map((s) => t >= s.end);
  const burnedBy = new Map<number, number>();
  let burned = 0;
  STEPS.forEach((s) => {
    const k = (Math.max(0, Math.min(t, s.end) - s.at) + loops * (s.end - s.at)) * s.tok;
    burnedBy.set(idx(s.who), (burnedBy.get(idx(s.who)) ?? 0) + k);
    burned += k;
  });
  const runsDone = done.filter(Boolean).length + loops * STEPS.length;
  const agents = base.agents.map((a, i) => {
    const cur = STEPS.findIndex((s, j) => active[j] && idx(s.who) === i);
    const fin = STEPS.filter((s, j) => idx(s.who) === i && done[j]).length + loops * STEPS.filter((s) => idx(s.who) === i).length;
    const tokN = a.tokN + Math.round(burnedBy.get(i) ?? 0);
    return {
      ...a, tokN, tok: fmt(tokN), runs: a.runs + fin, ok: a.ok + fin,
      st: cur >= 0 ? ("running" as const) : a.st === "paused" ? a.st : ("idle" as const),
      hb: cur >= 0 ? "now" : a.hb,
      cur: cur >= 0 ? STEPS[cur].txt : undefined, curT: cur >= 0 ? `${Math.max(1, Math.round(t - STEPS[cur].at))} s` : undefined, since: cur >= 0 ? "now" : undefined,
    };
  });
  const feed: FeedRow[] = [];
  STEPS.forEach((s, i) => {
    if (!active[i] && !done[i]) return;
    const el = Math.min(t, s.end) - s.at;
    feed.unshift({ t: clock(s.at), a: agents[idx(s.who)].n, aid: agents[idx(s.who)].id, i: s.id, r: s.txt, s: active[i] ? "run" : "ok", d: `${Math.round(el)} s`, k: fmt(el * s.tok) });
  });
  const talk = STEPS.filter((_, i) => active[i] || done[i]).map((s) => [s.talk[0], s.talk[1], s.talk[2]] as [string, string, string]).reverse().slice(0, 4);
  const running = agents.filter((a) => a.st === "running").length;
  const tokTodayN = base.tokTodayN + burned;
  const prReady = t >= 38;
  const wait: Wait[] = prReady
    ? [{ id: "SIM-1", t: "Merge CSV export for reports", kind: "PR to merge", st: "in_review", age: "now", ageMin: 0, pr: "Acme Storefront", ag: agents[idx(4)].n, why: "Review and smoke test passed.", runs: STEPS.length, tok: fmt(burned), cm: [], url: "https://example.com/pr/43" }, ...base.wait]
    : base.wait;
  const live = [t < 7, t >= 7 && t < 26, t >= 20 && t < 38, prReady];
  return {
    ...base, agents, wait, talk: talk.length ? talk : base.talk,
    flow: base.flow.map((f, i) => ({ ...f, on: live[i] ?? f.on })),
    days: base.days.map((d, i) => (i === base.days.length - 1 ? { ...d, v: tokTodayN } : d)),
    tokTodayN, tokToday: fmt(tokTodayN), usd: `≈ $${(14 + burned * 0.000011).toFixed(2)}`,
    feed: [...feed, ...base.feed], done24: base.done24 + runsDone,
    kpi: { ...base.kpi, runs: base.kpi.runs + runsDone + running, running },
    waitOldest: prReady ? "now" : base.waitOldest,
  };
};

// Crew view of the same run (team, tasks, spend): step i is played by team[CREW[i]]
const CREW = [0, 1, 2, 4, 0, 4];
export const simCrew = (team: TeamMember[], tasks: Task[], elapsed: number): { team: TeamMember[]; tasks: Task[]; burned: number } => {
  const t = elapsed % LOOP, loops = Math.floor(elapsed / LOOP);
  const who = (i: number): number => CREW[i] % team.length;
  const burn = new Map<number, number>();
  let burned = 0;
  STEPS.forEach((s, i) => {
    const k = (Math.max(0, Math.min(t, s.end) - s.at) + loops * (s.end - s.at)) * s.tok;
    burn.set(who(i), (burn.get(who(i)) ?? 0) + k);
    burned += k;
  });
  const cur = STEPS.map((s, i) => (t >= s.at && t < s.end ? i : -1)).filter((i) => i >= 0);
  const out = team.map((m, mi) => {
    const i = cur.find((c) => who(c) === mi);
    const tokens_today = m.tokens_today + Math.round(burn.get(mi) ?? 0);
    if (i === undefined) return { ...m, tokens_today };
    return { ...m, tokens_today, task_id: 90, task_title: TITLE, task_status: (i === 4 ? "review" : "doing") as TeamMember["task_status"], last_step: STEPS[i].txt, last_message: STEPS[i].talk[2], last_message_at: new Date().toISOString().slice(0, 19).replace("T", " "), context_pct: 20 + Math.round(t * 1.5) };
  });
  const owner = team[who(cur[0] ?? STEPS.length - 1)].id;
  const task: Task = { id: 90, title: TITLE, brief: "CEO request: CSV export for the reports page", owner_id: owner, reviewer_id: team[0].id, status: t >= 38 ? "review" : t < 1 ? "todo" : "doing", handoff_note: null, pr_url: t >= 38 ? "https://example.com/pr/43" : null, token_cap: 200000, created_at: new Date(Date.now() - t * 1000).toISOString().slice(0, 19).replace("T", " ") };
  return { team: out, tasks: [task, ...tasks], burned };
};

// Server-side switch: started from the UI or with ?autoplay=1, runs until stopped.
let startedAt: number | null = null;
export const simStatus = (): { on: boolean; t: number } => ({ on: startedAt !== null, t: startedAt === null ? 0 : (Date.now() - startedAt) / 1000 });
export const simSet = (on: boolean): void => { if (on && startedAt === null) startedAt = Date.now(); if (!on) startedAt = null; };
