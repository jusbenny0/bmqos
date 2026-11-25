import { esc } from "@/lib/stage";
import { tok } from "@/lib/format";
import { mst, MLBL, initial, roleOf, type Mst } from "./crew";
import { barChart, donut, usd } from "./charts";
import type { Graph, Task, TaskStatus, TeamMember, Usage } from "@/lib/crew";

interface RunEv { kind: string; text: string; created_at: string }
interface RunDetail { id: number; events: RunEv[]; tokens: { cost_usd: number; cache_write: number; output: number; input: number } }

/* Home as dashboard: widgets Running employees / Company tasks / Vault·Brain / Spend.
   Same idiom as loadOps/loadCrewStrip in home.ts – own cache, fetch outside React, patch #id after loading. */

/* ---------- Running employees (read-only; assignment goes through CEO) ---------- */
const CDOT: Record<Mst, string> = { busy: "", wait: "a", idle: "g" };

const ctxBar = (pct: number | null): string => pct === null ? '<span class="mono dim">–</span>' : `<span class="ctxb" title="${pct}% of window"><i style="width:${Math.min(100, pct)}%"></i></span><span class="mono">${pct}%</span>`;

export const PAL = ["var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)", "var(--c5)", "var(--c6)"];
const colorOf = (id: number): string => PAL[(id - 1 + PAL.length * 10) % PAL.length];
const crewRow = (m: TeamMember): string => {
  const st = mst(m), [rn, desc] = roleOf(m.role), mod = m.model === "sonnet" ? "Sonnet" : m.model === "haiku" ? "Haiku" : esc(m.model);
  return `<button class="d-crow" data-crew-m="${m.id}"><div class="ava sm" style="background:${colorOf(m.id)};color:#fff">${esc(initial(m.name))}</div>
 <div class="d-crow-a"><b>${esc(m.name)}</b><span class="d-crow-st"><i class="dot${st === "busy" ? " p" : ""} ${CDOT[st]}"></i>${MLBL[st]}</span><span class="d-crow-tok mono" title="tokens today">${tok(m.tokens_today)}</span></div>
 <div class="d-crow-b"><span class="d-crow-r">${esc(rn)}${desc ? ` · ${esc(desc)}` : ""} · ${mod}</span><span class="d-crow-c">${ctxBar(m.context_pct)}</span></div>
 <div class="d-crow-t">${m.task_title ? esc(m.task_title) : '<span class="dim">no task</span>'}</div></button>`;
};

let crewData: TeamMember[] | null = null, crewErr = false, crewAt = 0, crewBusy = false;
export const crewDashHTML = (): string => {
  if (crewErr) return '<div class="hint" style="padding:12px 0">Couldn\'t load the team.</div>';
  if (!crewData) return `<div class="d-crow sk"></div><div class="d-crow sk"></div><div class="d-crow sk"></div>`;
  if (!crewData.length) return '<div class="hint" style="padding:12px 0">No one on the team yet.</div>';
  const rank: Record<Mst, number> = { busy: 0, wait: 1, idle: 2 };
  const xs = [...crewData].sort((a, b) => rank[mst(a)] - rank[mst(b)] || b.tokens_today - a.tokens_today);
  const act = xs.filter((m) => mst(m) !== "idle"), idle = xs.filter((m) => mst(m) === "idle");
  return (act.map(crewRow).join("") || '<div class="hint" style="padding:6px 0 10px">No one is working right now.</div>')
    + (idle.length ? `<div class="d-idle"><span>Free:</span>${idle.map((m) => `<button class="ava sm" data-crew-m="${m.id}" title="${esc(m.name)}" style="background:${colorOf(m.id)};color:#fff">${esc(initial(m.name))}</button>`).join("")}</div>` : "");
};
/* demo simulator: poll fast while it runs */
let fast = false;
export const setSimFast = (on: boolean): void => { fast = on; };
const gap = (ms: number): number => (fast ? 800 : ms);
export const loadCrewDash = (): void => {
  if (crewBusy || Date.now() - crewAt < gap(10_000)) return;
  crewBusy = true;
  void fetch("/api/crew/team", { cache: "no-store" }).then((r) => (r.ok ? (r.json() as Promise<TeamMember[]>) : null))
    .then((j) => { crewErr = !j; if (j) crewData = j; }).catch(() => { crewErr = true; }).finally(() => {
      crewBusy = false; crewAt = Date.now(); paintUsage();
      const el = typeof document !== "undefined" ? document.getElementById("d-crew") : null;
      if (el) el.innerHTML = crewDashHTML();
      paintKpi();
    });
};

/* ---------- Company tasks: counts + latest in progress + assign CEO task ---------- */
export const COLS: [TaskStatus, string][] = [["todo", "Assigned"], ["doing", "In progress"], ["review", "Review"], ["blocked", "Blocked"], ["done", "Done"]];
const taskRow = (t: Task, team: TeamMember[]): string => {
  const owner = team.find((m) => m.id === t.owner_id);
  return `<button class="d-trow" data-crew-t="${t.id}"><b>${esc(t.title)}</b><span class="mono">${owner ? esc(owner.name) : "unassigned"} · ${esc(COLS.find(([s]) => s === t.status)?.[1] ?? t.status)}</span></button>`;
};
let tasksData: Task[] | null = null, tasksTeam: TeamMember[] = [], tasksErr = false, tasksAt = 0, tasksBusy = false;
export const composerHTML = (): string => `<form class="crtask d-crtask" data-crew-task-form><textarea name="text" rows="2" placeholder="Give the CEO a task – write what the Crew should do" maxlength="4000" aria-label="Give the CEO a task"></textarea><button class="btn p" type="submit">Submit</button></form>`;
export const tasksDashHTML = (): string => {
  const composer = composerHTML();
  if (tasksErr) return `${composer}<div class="hint" style="padding:12px 0">Couldn't load tasks.</div>`;
  if (!tasksData) return `${composer}<div class="d-counts">${COLS.map(() => '<div class="d-cnt sk"></div>').join("")}</div>`;
  const TC: Record<TaskStatus, string> = { todo: "var(--c5)", doing: "var(--c1)", review: "var(--c3)", blocked: "var(--red)", done: "var(--c4)" } as Record<TaskStatus, string>;
  const cnt = COLS.map(([s, l]) => [s, l, tasksData!.filter((t) => t.status === s).length] as const), all = Math.max(1, tasksData.length);
  const counts = `<div class="d-pipe" role="img" aria-label="Task breakdown by status">${cnt.filter(([, , n]) => n).map(([s, l, n]) => `<i style="flex:${n};background:${TC[s]}" title="${l}: ${n}"></i>`).join("") || '<i style="flex:1;background:var(--line2)"></i>'}</div>
<div class="d-legend">${cnt.map(([s, l, n]) => `<span><i style="background:${TC[s]}"></i>${l} <b>${n}</b></span>`).join("")}</div>`;
  void all;
  const moving = [...tasksData].filter((t) => t.status !== "done").sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, 4);
  return `${composer}${counts}<div class="lbl d-mini">In progress</div><div class="d-tlist">${moving.map((t) => taskRow(t, tasksTeam)).join("") || '<div class="hint" style="padding:8px 0">Nothing is happening right now.</div>'}</div>`;
};
export const loadTasksDash = (): void => {
  if (tasksBusy || Date.now() - tasksAt < gap(10_000)) return;
  tasksBusy = true;
  void Promise.all([
    fetch("/api/crew/tasks", { cache: "no-store" }).then((r) => (r.ok ? (r.json() as Promise<Task[]>) : null)),
    fetch("/api/crew/team", { cache: "no-store" }).then((r) => (r.ok ? (r.json() as Promise<TeamMember[]>) : null)),
  ]).then(([t, team]) => { tasksErr = !t; if (t) tasksData = t; if (team) tasksTeam = team; }).catch(() => { tasksErr = true; }).finally(() => {
    tasksBusy = false; tasksAt = Date.now();
    const el = typeof document !== "undefined" ? document.getElementById("d-tasks") : null;
    if (el) el.innerHTML = tasksDashHTML();
    const rn = typeof document !== "undefined" ? document.getElementById("d-runs") : null;
    if (rn) rn.innerHTML = runsDashHTML();
    paintKpi();
    loadRunDetails();
  });
};

/* ---------- Vault / Brain: search + graph preview ---------- */
const GROUP_COLOR: Record<string, string> = { projects: "#e0531f", projekty: "#e0531f", decisions: "#b8790f", rozhodnuti: "#b8790f", handoff: "#2f6fb3", voice: "#7a5cc4" };
const graphPreview = (g: Graph): string => {
  if (!g.nodes.length) return "";
  const cx = 110, cy = 70, r = 48;
  const pos = new Map(g.nodes.map((n, i) => [n.id, { x: cx + r * Math.cos((i / g.nodes.length) * Math.PI * 2 - Math.PI / 2), y: cy + r * Math.sin((i / g.nodes.length) * Math.PI * 2 - Math.PI / 2) }]));
  const lines = g.links.map((l) => { const a = pos.get(l.source), b = pos.get(l.target); return a && b ? `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="rgba(29,28,36,.2)"/>` : ""; }).join("");
  const dots = g.nodes.map((n) => { const p = pos.get(n.id)!; return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4.5" fill="${GROUP_COLOR[n.group] ?? "#282828"}"/>`; }).join("");
  return `<svg viewBox="0 0 220 140" class="d-vgraph" role="img" aria-label="Knowledge graph preview">${lines}${dots}</svg>`;
};
let vaultGraph: Graph | null = null, vaultErr = false, vaultAt = 0, vaultBusy = false;
export const vaultDashHTML = (): string => {
  const search = `<form class="crbr-search d-vsearch" data-crew-search-form><input name="q" placeholder="Search Brain…" aria-label="Search Brain" autocomplete="off"></form>`;
  if (vaultErr) return `${search}<div class="hint" style="padding:12px 0">Couldn't load Brain.</div>`;
  if (!vaultGraph) return `${search}<div class="d-vgraph sk" style="height:140px"></div>`;
  const notes = vaultGraph.nodes.slice(0, 5);
  return `${search}<div class="d-vbody"><div class="d-vnotes">${notes.map((n) => `<a href="#crew-brain&node=${encodeURIComponent(n.id)}">${esc(n.title)}</a>`).join("") || '<div class="hint">Brain is still empty.</div>'}</div>${graphPreview(vaultGraph)}</div><a class="lnk" href="#crew-brain">Open full Brain</a>`;
};
export const loadVaultDash = (): void => {
  if (vaultBusy || Date.now() - vaultAt < 30_000) return;
  vaultBusy = true;
  void fetch("/api/crew/brain/graph", { cache: "no-store" }).then((r) => (r.ok ? (r.json() as Promise<Graph>) : null))
    .then((j) => { vaultErr = !j; if (j) vaultGraph = j; }).catch(() => { vaultErr = true; }).finally(() => {
      vaultBusy = false; vaultAt = Date.now();
      const el = typeof document !== "undefined" ? document.getElementById("d-vault") : null;
      if (el) el.innerHTML = vaultDashHTML();
    });
};

/* ---------- Spend: daily spend chart (7 days) + who cost how much ---------- */
let usageData: Usage | null = null, usageErr = false, usageAt = 0, usageBusy = false;
export const usageDashHTML = (): string => {
  if (usageErr) return '<div class="hint" style="padding:12px 0">Couldn\'t load spend.</div>';
  if (!usageData) return '<div class="sp"><div class="sk" style="height:150px"></div><div class="sk" style="height:220px"></div><div class="sk" style="height:180px"></div></div>';
  const s = usageData.series, today = s[s.length - 1], yest = s[s.length - 2], tot = usageData.total.cost_usd;
  const delta = yest && yest.cost_usd > 0 && today ? Math.round(((today.cost_usd - yest.cost_usd) / yest.cost_usd) * 100) : null;
  const costs = (tasksData ?? []).filter((t) => t.status === "done").map((t) => runDetails.get(t.id)?.tokens.cost_usd).filter((x): x is number => x !== undefined);
  const avg = costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : null;
  const team = crewData ?? tasksTeam;
  const slices = usageData.byEmployee.map((r) => { const m = team.find((t) => t.name === r.label); return { label: r.label, value: r.cost_usd, color: m ? colorOf(m.id) : "var(--c5)", href: m ? `#crew-team&id=${m.id}` : "#crew-team" }; });
  return `<div class="sp">
<div class="sp-num"><span class="sp-l">Today</span><b>${usd(today?.cost_usd ?? 0)}</b>${yest ? `<span class="sp-d ${delta !== null && delta > 0 ? "up" : "down"}">${delta !== null && Math.abs(delta) <= 300 ? `${delta > 0 ? "↑" : "↓"} ${Math.abs(delta)}% · ` : ""}yesterday ${usd(yest.cost_usd)}</span>` : ""}
<dl><div><dt>Past 7 days</dt><dd>${usd(tot)}</dd></div><div><dt>Avg per task</dt><dd>${avg === null ? "–" : usd(avg)}</dd></div><div><dt>Tokens today</dt><dd>${tok(today?.tokens ?? 0)}</dd></div></dl></div>
<div class="sp-chart">${barChart(s)}</div>
<div class="sp-who"><span class="sp-l">Who's spending · 7 days</span>${donut(slices, usd(tot), "total")}</div></div>`;
};
const paintUsage = (): void => { const el = typeof document !== "undefined" ? document.getElementById("d-usage") : null; if (el && usageData) el.innerHTML = usageDashHTML(); };

export const loadUsageDash = (): void => {
  if (usageBusy || Date.now() - usageAt < gap(30_000)) return;
  usageBusy = true;
  void fetch("/api/crew/usage?range=7d", { cache: "no-store" }).then((r) => (r.ok ? (r.json() as Promise<Usage>) : null))
    .then((j) => { usageErr = !j; if (j) usageData = j; }).catch(() => { usageErr = true; }).finally(() => {
      usageBusy = false; usageAt = Date.now();
      const el = typeof document !== "undefined" ? document.getElementById("d-usage") : null;
      if (el) el.innerHTML = usageDashHTML();
      paintKpi();
    });
};

/* ---------- Top summary: 4 colored numbers, each links to its section below ---------- */
let kpiWait = 0;
export const kpiHTML = (waiting: number | null = null): string => {
  if (waiting !== null) kpiWait = waiting;
  const busy = crewData ? crewData.filter((m) => mst(m) === "busy").length : null;
  const open = tasksData ? tasksData.filter((t) => t.status !== "done").length : null;
  const done = tasksData ? tasksData.filter((t) => t.status === "done").length : null;
  const today = usageData?.series[usageData.series.length - 1];
  const k = (c: string, href: string, n: string, l: string): string => `<a class="kpi" href="${href}" style="--k:${c}"><b>${n}</b><span>${l}</span></a>`;
  const v = (x: number | null): string => (x === null ? "–" : String(x));
  return k("var(--c2)", "#waiting", String(kpiWait), "needs you") + k("var(--c1)", "#crew-team", busy === null ? "–" : `${busy}/${crewData!.length}`, "agents working")
    + k("var(--c3)", "#crew-tasks", v(open), `tasks in progress${done !== null ? ` · ${done} done` : ""}`) + k("var(--c4)", "#crew-usage", today ? usd(today.cost_usd) : "–", "spend today");
};
const paintKpi = (): void => { if (typeof document === "undefined") return; const el = document.getElementById("d-kpi"); if (el) el.innerHTML = statsHTML(); };

/* ---------- Agent runs: each task = one run; step chain (who → who), duration, cost, PR ---------- */
const ST: Record<string, [string, string]> = { todo: ["Assigned", "var(--dim)"], doing: ["Running", "#16a34a"], review: ["Review", "var(--mute)"], blocked: ["Blocked", "var(--red)"], done: ["Done", "var(--dim)"] };
const utc = (s: string | undefined): number => (s ? Date.parse(s.replace(" ", "T") + "Z") : 0);
const dur = (ms: number): string => (ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))} s` : ms < 3_600_000 ? `${Math.round(ms / 60_000)} min` : `${(ms / 3_600_000).toFixed(1)} h`);
const ago = (s: string | undefined): string => { const m = (Date.now() - utc(s)) / 60_000; return m < 1 ? "now" : m < 60 ? `${Math.round(m)} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
const runDetails = new Map<number, RunDetail>();
const chain = (t: Task, det: RunDetail | undefined, team: TeamMember[]): string => {
  const names: string[] = [];
  const owner = team.find((m) => m.id === t.owner_id)?.name;
  if (det) for (const e of det.events) {
    const m = e.kind === "handoff" ? e.text.match(/→\s*([^(]+)/) : e.kind === "fallback" ? e.text.match(/→\s*([^(]+)/) : e.kind === "assign" || e.kind === "delegate" ? e.text.match(/(?:→|pro|:)\s*([A-ZÁ-Ž][\wÁ-ž ]+)/) : null;
    const nm = m?.[1]?.trim(); if (nm && names[names.length - 1] !== nm) names.push(nm);
  }
  if (owner && !names.includes(owner)) names.unshift(owner);
  const fail = det?.events.some((e) => e.kind === "error" || e.kind === "fallback");
  return `<span class="r-chain">CEO${names.map((n) => ` <i>→</i> ${esc(n)}`).join("")}</span>${fail ? '<span class="r-flag" title="Part of the run failed and someone else took over">fallback</span>' : ""}`;
};
const runRow = (t: Task, team: TeamMember[]): string => {
  const det = runDetails.get(t.id), [sl, sc] = ST[t.status] ?? [t.status, "var(--dim)"];
  const live = t.status === "doing" || t.status === "review";
  const ms = (t.status === "done" || t.status === "blocked" ? utc(t.updated_at ?? t.created_at) : Date.now()) - utc(t.created_at);
  return `<button class="run${live ? " live" : ""}" data-crew-t="${t.id}" style="--s:${sc}">
<span class="r-st"><i></i>${sl}</span>
<span class="r-main"><b>${esc(t.title)}</b><span class="r-sub">${chain(t, det, team)}</span></span>
<span class="r-m"><b>${det ? `$${det.tokens.cost_usd.toFixed(2)}` : "…"}</b><span>${dur(ms)} · ${ago(t.created_at)}</span></span>
${t.pr_url ? `<span class="r-pr" title="Pull request">PR</span>` : '<span class="r-pr off"></span>'}</button>`;
};
export const runsDashHTML = (): string => {
  if (tasksErr) return '<div class="hint" style="padding:12px 0">Couldn\'t load runs.</div>';
  if (!tasksData) return Array.from({ length: 5 }, () => '<div class="run sk"></div>').join("");
  const xs = [...tasksData].sort((a, b) => Number(b.status !== "done") - Number(a.status !== "done") || utc(b.updated_at) - utc(a.updated_at)).slice(0, 10);
  return xs.map((t) => runRow(t, tasksTeam)).join("") || '<div class="hint" style="padding:12px 0">No runs yet. Give the CEO a task.</div>';
};
let runsAt = 0;
const loadRunDetails = (): void => {
  if (!tasksData || Date.now() - runsAt < 15_000) return;
  runsAt = Date.now();
  const ids = [...tasksData].sort((a, b) => utc(b.updated_at) - utc(a.updated_at)).slice(0, 10).filter((t) => t.status !== "done" || !runDetails.has(t.id)).map((t) => t.id);
  void Promise.all(ids.map((id) => fetch(`/api/crew/tasks/${id}`, { cache: "no-store" }).then((r) => (r.ok ? (r.json() as Promise<RunDetail>) : null)).then((j) => { if (j) runDetails.set(id, j); }).catch(() => undefined)))
    .then(() => { const el = document.getElementById("d-runs"); if (el) el.innerHTML = runsDashHTML(); paintKpi(); paintUsage(); });
};

/* ---------- Stats: 6 numbers up top ---------- */
export const statsHTML = (): string => {
  const day = (s: string): boolean => Date.now() - utc(s) < 86_400_000;
  const busy = crewData ? crewData.filter((m) => mst(m) === "busy").length : null;
  const today = tasksData ? tasksData.filter((t) => day(t.created_at)).length : null;
  const done = tasksData ? tasksData.filter((t) => t.status === "done").length : null;
  const open = tasksData ? tasksData.filter((t) => t.status !== "done").length : null;
  const failed = tasksData ? tasksData.filter((t) => t.status === "blocked").length : null;
  const ok = done !== null && failed !== null && done + failed ? Math.round((done / (done + failed)) * 100) : null;
  const k = (c: string, n: string, l: string, href: string): string => `<a class="kpi" href="${href}" style="--k:${c}"><b>${n}</b><span>${l}</span></a>`;
  const v = (x: number | null): string => (x === null ? "–" : String(x));
  return k("var(--c1)", busy === null ? "–" : `${busy}/${crewData!.length}`, "agents working", "#crew-team")
    + k("var(--c5)", v(today), "runs in 24 h", "#crew-tasks")
    + k("var(--c3)", ok === null ? "–" : `${ok}%`, `success rate · ${v(done)} done`, "#crew-tasks")
    + k("var(--c4)", v(open), "in progress", "#crew-tasks");
};


export const loadDash = (): void => { loadCrewDash(); loadTasksDash(); loadVaultDash(); loadUsageDash(); };
