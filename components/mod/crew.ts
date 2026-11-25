import { esc } from "@/lib/stage";
import { tok } from "@/lib/format";
import { inline as mdi } from "@/lib/md";
import { barChart, donut, usd } from "./charts";
import type { BrainHit, BrainNode, Graph, Task, TaskDetail, TaskStatus, TeamMember, TranscriptMessage, Usage } from "@/lib/crew";

/* Crew (Company) – Team / Tasks / Spend / Brain. Data from proxy /api/crew/* (session-checked), shape per
   engine/docs/api.md. Defensive: missing/unknown fields don't render, .map is never called on an uncertain shape. */
export interface CrewTeamUi { list: TeamMember[] | null; err?: boolean }
export interface CrewTasksUi { list: Task[] | null; err?: boolean }
export interface CrewUsageUi { data: Record<"24h" | "7d", Usage | null>; err?: boolean }
export interface CrewTxUi { [empId: number]: { messages: TranscriptMessage[]; lastId: number } }
export type CrewSendSt = "busy" | "ok" | "err" | undefined;
export interface CrewBrainUi { hits: BrainHit[] | null; node: BrainNode | null; nodeErr?: boolean; graph: Graph | null }

const parseUTC = (s: string): number => Date.parse(`${s.replace(" ", "T")}Z`);
const ago = (s: string): string => {
  const m = Math.max(0, Math.round((Date.now() - parseUTC(s)) / 60_000));
  return m < 1 ? "now" : m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`;
};
const hm = (s: string): string => new Date(parseUTC(s)).toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Prague" });
const initial = (n: string): string => (n.trim()[0] ?? "?").toUpperCase();
const MODEL: Record<string, string> = { sonnet: "Sonnet", haiku: "Haiku" };

/* ---------- Team ---------- */
export type Mst = "busy" | "wait" | "idle";
export const mst = (m: TeamMember): Mst => (m.task_status === "doing" ? "busy" : m.task_status === "review" || m.task_status === "blocked" ? "wait" : "idle");
export const MLBL: Record<Mst, string> = { busy: "working", wait: "waiting", idle: "free" };
export { initial, MODEL };

/* English role names for Home and Team */
const ROLES: [RegExp, string, string][] = [
  [/^ceo$/i, "CEO", "splits up the work"],
  [/cto|plán/i, "CTO", "plans the team's work"],
  [/builder|engineer|vývoj|stavitel/i, "Builder", "writes code"],
  [/design/i, "Designer", "UI and look"],
  [/review|kontrolor/i, "Reviewer", "reviews code"],
  [/visual|vizuál/i, "Visual QA", "watches the look"],
  [/^qa$|kvalit/i, "QA", "tests finished work"],
  [/security|bezpečnost/i, "Security", "watches security"],
  [/junior|pracant|drobné/i, "Junior", "simple tasks"],
];
export const roleOf = (role: string): [string, string] => { const r = ROLES.find(([re]) => re.test(role)); return r ? [r[1], r[2]] : [role, ""]; };
const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n).trimEnd()}…` : s);
/* instructions load when the detail opens and overwrite #crins (without re-rendering the whole page) */
const insCache = new Map<number, { p: string; engine?: string; em?: string | null }>();
export const loadInstructions = (id: number): void => {
  const paint = (): void => { const v = insCache.get(id); if (v) document.querySelectorAll(`[data-crins="${id}"]`).forEach((el) => { el.innerHTML = insHTML(v); }); };
  if (insCache.has(id)) return paint();
  void fetch(`/api/crew/team/${id}/instructions`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j: { system_prompt: string; engine?: string; engine_model?: string | null } | null) => {
    insCache.set(id, j ? { p: j.system_prompt, engine: j.engine, em: j.engine_model } : { p: "" }); paint();
  }).catch(() => undefined);
};
const insHTML = (v: { p: string; engine?: string; em?: string | null }): string => (v.p ? `<div class="crins-p md">${mdi(v.p)}</div>` : '<div class="hint">No instructions set.</div>') + (v.engine && v.engine !== "claude" ? `<div class="hint" style="margin-top:8px">Runs via ${esc(v.engine)}${v.em ? ` · ${esc(v.em)}` : ""}</div>` : "");
const memberCard = (m: TeamMember, i: number): string => {
  const st = mst(m);
  const dot = `<i class="dot${st === "busy" ? " p" : ""} ${st === "busy" ? "" : st === "wait" ? "a" : "g"}"></i>`;
  return `<button class="crm" data-crew-m="${m.id}" style="--i:${Math.min(i, 8)}"><div class="crm-h"><div class="ava">${esc(initial(m.name))}</div><div class="crm-n"><b>${esc(m.name)}</b><span>${esc(roleOf(m.role)[1] || roleOf(m.role)[0])} · ${MODEL[m.model] ?? esc(m.model)}</span></div><span class="crm-st">${dot}${MLBL[st]}</span></div>
 <div class="crm-t">${m.task_title ? `<b>${esc(m.task_title)}</b>${m.last_step ? `<span>${esc(clip(m.last_step, 140))}</span>` : ""}` : `<span class="dim">No task</span>`}</div>
 <div class="crm-ins" data-crins="${m.id}">${insCache.has(m.id) ? insHTML(insCache.get(m.id)!) : '<div class="sk" style="height:60px"></div>'}</div>
 <div class="crm-f"><span class="mono">${tok(m.tokens_today)} tokens today</span></div></button>`;
};

export const crewTeamHTML = (d: CrewTeamUi | null): string => {
  const head = (s: string): string => `<div class="pagehead"><div><div class="lbl" style="margin-bottom:10px">Company · Crew</div><h1>Team</h1><p class="d-sub" style="margin-top:6px">${s}</p></div></div>`;
  if (!d) return `<div class="screen page"><div class="col">${head("Loading team…")}<div class="crm-grid">${Array.from({ length: 4 }, () => '<div class="crm sk"></div>').join("")}</div></div></div>`;
  if (d.err || !d.list) return `<div class="screen page"><div class="col">${head("Couldn't load the team.")}<div class="pj-empty">Crew API isn't responding. Try again shortly.</div></div></div>`;
  const working = d.list.filter((m) => mst(m) === "busy").length;
  const tokens = d.list.reduce((s, m) => s + m.tokens_today, 0);
  const lead = `${working} working of ${d.list.length} · ${tok(tokens)} tokens today`;
  return `<div class="screen page"><div class="col">${head(lead)}<div class="crm-grid">${d.list.map(memberCard).join("") || '<div class="pj-empty">No one on the team yet.</div>'}</div></div></div>`;
};

const bubble = (m: TranscriptMessage): string =>
  `<div class="crb ${m.role === "user" ? "me" : m.role}"><div class="crb-b">${mdi(m.content)}</div><div class="crb-f mono">${hm(m.created_at)}${m.input_tokens || m.output_tokens ? ` · ${tok(m.input_tokens + m.output_tokens)} tok` : ""}</div></div>`;

// The detail is purely informative: the owner assigns work only to the CEO (give a task to the company in Tasks), never to an individual employee.
export const crewMemberSheet = (m: TeamMember | undefined, tx: CrewTxUi): string => {
  if (!m) return "";
  const st = mst(m);
  const t = tx[m.id];
  const log = t?.messages.length ? t.messages.map(bubble).join("") : '<div class="hint" style="padding:18px 0">No messages yet.</div>';
  return `<div class="scrim" data-close></div><aside class="sheet crsheet" role="dialog" aria-label="${esc(m.name)}"><div class="hd"><span class="lbl">Employee</span><button class="x" data-close>Close ✕</button></div><div class="bd">
 <div style="display:flex;gap:18px;align-items:center"><div class="ava lg">${esc(initial(m.name))}</div><div><h2 style="font-size:28px;font-weight:600;letter-spacing:-.02em;line-height:1.15">${esc(m.name)}</h2><div class="mono" style="margin-top:6px">${esc(roleOf(m.role)[1] || roleOf(m.role)[0])} · ${MODEL[m.model] ?? esc(m.model)}</div></div></div>
 <div class="two"><div><span class="lbl">Status</span><b style="display:block;margin-top:4px" class="${st === "busy" ? "lime" : st === "wait" ? "amber" : ""}">${st === "busy" ? "● " : ""}${MLBL[st]}</b></div><div><span class="lbl">Tokens today</span><b style="display:block;margin-top:4px">${tok(m.tokens_today)}</b></div></div>
 ${m.task_title ? `<div class="why"><div class="lbl" style="margin-bottom:6px">Current task</div><div class="hint"><b style="color:var(--ink)">${esc(m.task_title)}</b>${m.last_step ? `<br>${esc(m.last_step)}` : ""}</div></div>` : ""}
 <div class="lbl" style="margin-top:4px">Instructions</div>
 <div class="crins" data-crins="${m.id}">${insCache.has(m.id) ? insHTML(insCache.get(m.id)!) : '<div class="sk" style="height:96px;border-radius:10px"></div>'}</div>
 <details class="crtx"><summary>Work transcript (read-only)</summary><div class="crlog" id="crlog-${m.id}">${log}</div></details>
 <div class="hint">Work goes through the CEO in Tasks – not directly to the employee.</div>
 </div></aside>`;
};

/* ---------- Tasks (kanban) ---------- */
const COLS: [TaskStatus, string][] = [["todo", "Assigned"], ["doing", "In progress"], ["review", "Review"], ["done", "Done"], ["blocked", "Blocked"]];
const age = (iso: string): string => ago(iso.replace("T", " ").replace("Z", ""));

const taskCard = (t: Task, team: TeamMember[]): string => {
  const owner = team.find((m) => m.id === t.owner_id);
  return `<button class="crk" data-crew-t="${t.id}"><b>${esc(t.title)}</b><div class="crk-m"><span class="ava sm" title="${owner ? esc(owner.name) : "unassigned"}">${owner ? esc(initial(owner.name)) : "–"}</span><span class="mono">${age(t.created_at)}</span>${t.pr_url ? '<span class="mono">PR</span>' : ""}</div></button>`;
};

/* Goals: big goals with percent done; task belongs to a goal by title/brief, click expands its tasks */
const GOALS: { n: string; re: RegExp; c: string }[] = [
  { n: "BMQOS", re: /bmqos|agentic.?os|localhost|dashboard/i, c: "var(--c1)" },
  { n: "Crew", re: /crew|agent|token|e2e|readme|hello\.md|delegac|pracant|security|qa\b/i, c: "var(--c3)" },
  { n: "Acme Storefront", re: /acme|storefront|shop|settings/i, c: "var(--c2)" },
  { n: "Mobile App", re: /mobile|\bapp\b|deploy|screenshots/i, c: "var(--c4)" },
];
const goalOf = (t: Task): (typeof GOALS)[number] => GOALS.find((g) => g.re.test(`${t.title} ${t.brief ?? ""}`)) ?? { n: "Other", re: /./, c: "var(--c5)" };
export const crewTasksHTML = (d: CrewTasksUi | null, team: TeamMember[] | null, open: string, compact: boolean): string => {
  void compact;
  const head = (s: string): string => `<div class="pagehead"><div><h1>Goals<span>${s}</span></h1></div></div>`;
  const composer = `<form class="crtask" data-crew-task-form><textarea name="text" rows="2" placeholder="Give the CEO a task – write what the company should do" maxlength="4000" aria-label="Give the CEO a task"></textarea><button class="btn p" type="submit">Submit</button></form>`;
  if (!d) return `<div class="screen page"><div class="col">${head("Loading…")}${composer}<div class="goals">${Array.from({ length: 3 }, () => '<div class="goal sk"></div>').join("")}</div></div></div>`;
  if (d.err || !d.list) return `<div class="screen page"><div class="col">${head("Couldn't load goals.")}${composer}<div class="pj-empty">Crew API isn't responding. Try again shortly.</div></div></div>`;
  const team0 = team ?? [];
  const by = new Map<string, { g: (typeof GOALS)[number]; xs: Task[] }>();
  for (const t of d.list) { const g = goalOf(t); const e = by.get(g.n) ?? { g, xs: [] }; e.xs.push(t); by.set(g.n, e); }
  const ST: Record<string, string> = { todo: "assigned", doing: "in progress", review: "review", blocked: "blocked", done: "done" };
  const cards = [...by.values()].sort((a, b) => b.xs.length - a.xs.length).map(({ g, xs }) => {
    const done = xs.filter((t) => t.status === "done").length, pct = Math.round((done / xs.length) * 100), on = open === g.n;
    const live = xs.filter((t) => t.status === "doing" || t.status === "review").length, bad = xs.filter((t) => t.status === "blocked").length;
    const rows = on ? `<div class="goal-list">${[...xs].sort((a, b) => Number(a.status === "done") - Number(b.status === "done") || b.id - a.id).map((t) => { const ow = team0.find((m) => m.id === t.owner_id); return `<button class="goal-t st-${t.status}" data-crew-t="${t.id}"><i></i><b>${esc(t.title)}</b><span>${ow ? esc(ow.name) + " · " : ""}${ST[t.status] ?? t.status}${t.pr_url ? " · PR" : ""}</span></button>`; }).join("")}</div>` : "";
    return `<section class="goal${on ? " open" : ""}" style="--g:${g.c}"><a class="goal-h" href="#crew-tasks${on ? "" : `&agent=${encodeURIComponent(g.n)}`}" aria-expanded="${on}">
<span class="goal-n">${esc(g.n)}</span><span class="goal-pct">${pct} %</span>
<span class="goal-bar"><i style="width:${pct}%"></i></span>
<span class="goal-m">${done} of ${xs.length} done${live ? ` · ${live} running` : ""}${bad ? ` · ${bad} blocked` : ""}</span></a>${rows}</section>`;
  }).join("");
  return `<div class="screen page"><div class="col">${head(`${d.list.length} tasks in ${by.size} goals`)}${composer}<div class="goals">${cards || '<div class="pj-empty">No goals yet. Give the CEO a task.</div>'}</div></div></div>`;
};


/* Company task detail (workflow): plain-language status + what happens next, brief, step-by-step progress, PR and cost, and a question to the CEO directly on the task */
const STLBL: Record<string, [string, string]> = {
  todo: ["Assigned", "The CEO will split the task and hand it to an agent."], doing: ["In progress", "An agent is working on the task right now."], review: ["Review", "The reviewer is checking the result."],
  blocked: ["Stuck", "The agent can't continue on its own – tell the CEO how to proceed."], done: ["Done", "The task is finished and reviewed."],
};
const evText = (e: { kind: string; text: string }): string => {
  if (e.kind === "status") return `Status → <b>${esc(STLBL[e.text]?.[0] ?? e.text)}</b>`;
  if (e.kind === "handoff") return `Handed off ${esc(e.text.replace(/^→\s*/, "").replace(/\s*\(.*\)$/, ""))}`;
  if (e.kind === "fallback") return `Fallback: ${esc(e.text)}`;
  if (e.kind === "error") return `<span class="er">Error:</span> ${esc(e.text.split("\n")[0].slice(0, 160))}`;
  const one = e.text.replace(/\s+/g, " ").trim();
  return esc(one.length > 120 ? `${one.slice(0, 120)}…` : one);
};
export const crewTaskSheet = (t: TaskDetail | null, err: boolean, id: string): string => {
  const shell = (title: string, body: string): string => `<div class="scrim" data-close></div><aside class="sheet tsheet" role="dialog" aria-label="${esc(title)}"><div class="hd"><span class="lbl">${esc(title)}</span><button class="x" data-close>Close ✕</button></div><div class="bd">${body}</div></aside>`;
  if (err) return shell("Task", `<div class="pj-empty">Task ${esc(id)} wasn't found.</div>`);
  if (!t) return shell("Task", '<div class="sk" style="height:28px;width:70%"></div><div class="sk" style="height:90px"></div><div class="sk" style="height:200px"></div>');
  const [sl, sd] = STLBL[t.status] ?? [t.status, ""];
  const steps = t.events.filter((e) => e.kind !== "handoff" || !t.events.some((x, j) => x !== e && x.kind === e.kind && x.text === e.text && t.events.indexOf(x) < t.events.indexOf(e)));
  return shell(`Task #${t.id}`, `<h2 class="ts-t">${esc(t.title)}</h2>
<div class="ts-st st-${t.status}"><i></i><div><b>${esc(sl)}</b><span>${esc(sd)}</span></div></div>
<div class="ts-kv"><div><span>Cost</span><b>$${t.tokens.cost_usd.toFixed(2)}</b></div><div><span>Steps</span><b>${steps.length}</b></div><div><span>Result</span><b>${t.pr_url ? `<a href="${esc(t.pr_url)}" target="_blank" rel="noopener noreferrer">PR ↗</a>` : "–"}</b></div></div>
<form class="crtask ts-ask" data-crew-task-form data-task="${t.id}"><textarea name="text" rows="2" placeholder="${t.status === "blocked" ? "Tell the CEO how the task should proceed…" : "Write to the CEO about this task (add, change, stop)…"}" maxlength="4000" aria-label="Message the CEO about this task"></textarea><button class="btn p" type="submit">Send to CEO</button></form>
<details class="ts-brief"><summary>Brief</summary><div class="hint">${mdi(t.brief)}</div></details>
${t.handoff_note ? `<div class="why"><div class="lbl" style="margin-bottom:6px">Last handoff</div><div class="hint">${mdi(t.handoff_note)}</div></div>` : ""}
<div><div class="lbl" style="margin-bottom:8px">Progress</div><ol class="ts-tl">${steps.map((e) => `<li class="k-${esc(e.kind)}"><span class="mono">${hm(e.created_at)}</span><p>${evText(e)}</p></li>`).join("") || "<li><p>Nothing yet.</p></li>"}</ol></div>`);
};


/* ---------- Spend: same charts as Home (area over time, agent share, costliest tasks) ---------- */
const PAL6 = ["var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)", "var(--c5)", "var(--c6)"];
const shareBar = (rows: { label: string; tokens: number; cost_usd: number }[], href: (r: { label: string }) => string): string => {
  const xs = rows.filter((r) => r.cost_usd > 0 || r.tokens > 0).sort((a, b) => b.cost_usd - a.cost_usd || b.tokens - a.tokens);
  if (!xs.length) return '<div class="pj-empty">No data yet.</div>';
  const sum = xs.reduce((t, r) => t + r.cost_usd, 0) || 1, mx = xs[0].cost_usd || 1;
  return `<div class="u-rows">${xs.map((r, i) => `<a class="u-row" href="${href(r)}"><span class="u-n"><i style="background:${PAL6[i % 6]}"></i>${esc(r.label)}</span><span class="u-bar"><i style="width:${Math.max(3, (r.cost_usd / mx) * 100).toFixed(0)}%;background:${PAL6[i % 6]}"></i></span><b>${usd(r.cost_usd)}</b><em>${Math.round((r.cost_usd / sum) * 100)} % · ${tok(r.tokens)}</em></a>`).join("")}</div>`;
};
export const crewUsageHTML = (d: CrewUsageUi, range: "24h" | "7d", compact: boolean): string => {
  void compact;
  const head = `<div class="pagehead" style="flex-wrap:wrap;gap:12px"><div><h1>Spend</h1></div><div class="seg" role="group" aria-label="Range">${(["24h", "7d"] as const).map((r) => `<a href="#crew-usage&range=${r}" aria-pressed="${r === range}">${r === "24h" ? "24 h" : "7 days"}</a>`).join("")}</div></div>`;
  if (d.err) return `<div class="screen page"><div class="col">${head}<div class="pj-empty">Couldn't load spend.</div></div></div>`;
  const u = d.data[range];
  if (!u) return `<div class="screen page"><div class="col">${head}<div class="u-kpis">${Array.from({ length: 4 }, () => '<div class="kpi sk" style="height:96px"></div>').join("")}</div><div class="dcard sk" style="height:260px;margin-top:20px"></div></div></div>`;
  const runs = u.byTask.length, per = runs ? u.total.cost_usd / runs : 0;
  const ceo = u.byEmployee.find((r) => /ceo/i.test(r.label));
  const k = (c: string, n: string, l: string): string => `<div class="kpi" style="--k:${c}"><b>${n}</b><span>${l}</span></div>`;
  return `<div class="screen page"><div class="col">${head}
<div class="u-kpis">${k("var(--c1)", usd(u.total.cost_usd), range === "24h" ? "last 24 hours" : "last 7 days")}${k("var(--c3)", runs ? usd(per) : "–", `average per task · ${runs} tasks`)}${k("var(--c2)", ceo ? `${Math.round((ceo.cost_usd / (u.total.cost_usd || 1)) * 100)} %` : "–", "CEO share (planning)")}${k("var(--c4)", tok(u.total.tokens), "tokens")}</div>
<section class="dcard u-chart"><h2>Spend over time</h2>${barChart(u.series, range === "24h")}</section>
<div class="u-two"><section class="dcard"><h2>Who cost how much</h2>${donut(u.byEmployee.map((r, i) => ({ label: r.label, value: r.cost_usd, color: PAL6[i % 6], href: "#crew-team" })), usd(u.total.cost_usd), "total")}</section>
<section class="dcard"><h2>Costliest tasks</h2>${shareBar(u.byTask.slice(0, 8), (r) => `#crew-tasks`)}</section></div>
</div></div>`;
};


/* ---------- Brain ---------- */
const GROUP_COLOR: Record<string, string> = { projects: "#e0531f", projekty: "#e0531f", decisions: "#b8790f", rozhodnuti: "#b8790f", handoff: "#2f6fb3", voice: "#7a5cc4" };
export const nodeColor = (g: string): string => GROUP_COLOR[g] ?? "#282828";

export const crewBrainHTML = (q: string, hits: BrainHit[] | null): string => {
  const results = q && hits ? `<div class="crbr-res">${hits.length ? hits.map((h) => `<a href="#crew-brain&node=${encodeURIComponent(h.id)}"><b>${esc(h.title)}</b><span>${esc(h.snippet)}</span></a>`).join("") : '<div class="hint" style="padding:12px 16px">Nothing found.</div>'}</div>` : "";
  return `<div class="screen page crbrain"><div class="col"><div class="pagehead"><div><div class="lbl" style="margin-bottom:10px">Company · Crew</div><h1>Brain<span>Company knowledge base</span></h1></div></div>
 <form class="crbr-search" data-crew-search-form><input name="q" value="${esc(q)}" placeholder="Search Brain (projects, decisions, handoffs…)" aria-label="Search Brain" autocomplete="off"></form>
 ${results}
 <div class="crbr-graph"><canvas id="crewgraph" aria-label="Knowledge graph"></canvas><div class="crbr-tip"></div><div class="crbr-legend">${Object.entries(GROUP_COLOR).map(([g, c]) => `<span><i style="background:${c}"></i>${esc(g)}</span>`).join("")}</div></div>
 </div></div>`;
};

export const crewNodeSheet = (n: BrainNode | null, err: boolean, id: string): string => {
  if (err) return `<div class="scrim" data-close></div><aside class="sheet" role="dialog" aria-label="Node"><div class="hd"><span class="lbl">Brain</span><button class="x" data-close>Close ✕</button></div><div class="bd"><div class="pj-empty">Node "${esc(id)}" wasn't found.</div></div></aside>`;
  if (!n) return `<div class="scrim" data-close></div><aside class="sheet" role="dialog" aria-label="Node"><div class="hd"><span class="lbl">Brain</span><button class="x" data-close>Close ✕</button></div><div class="bd"><div class="card skel" aria-busy="true"><div class="sk"></div><div class="sk"></div></div></div></aside>`;
  return `<div class="scrim" data-close></div><aside class="sheet" role="dialog" aria-label="${esc(n.title)}"><div class="hd"><span class="lbl">Brain</span><button class="x" data-close>Close ✕</button></div><div class="bd">
 <div class="mono" style="color:var(--dim)">${esc(n.id)}</div><h2>${esc(n.title)}</h2>
 <div class="md">${mdi(n.body).split("\n").map((l) => `<p>${l}</p>`).join("")}</div>
 ${n.links.length ? `<div><div class="lbl" style="margin-bottom:8px">Links to</div><div class="chips">${n.links.map((l) => `<a class="chip2" href="#crew-brain&node=${encodeURIComponent(l)}">${esc(l)}</a>`).join("")}</div></div>` : ""}
 </div></aside>`;
};

/* ---------- graph: custom force-directed layout on canvas (no library), drag/zoom/pinch/click ---------- */
export const mountCrewGraph = (root: HTMLElement): (() => void) => {
  const canvas = root.querySelector<HTMLCanvasElement>("#crewgraph");
  const tip = root.querySelector<HTMLElement>(".crbr-tip");
  if (!canvas) return () => undefined;
  let raf = 0, alive = true, graph: Graph | null = null;
  let nodes: { id: string; title: string; group: string; x: number; y: number; vx: number; vy: number; pinned?: boolean }[] = [];
  let view = { x: 0, y: 0, k: 1 };
  let center = { x: 240, y: 180 };
  let drag: { id: string } | null = null, panStart: { x: number; y: number; vx: number; vy: number } | null = null, pinchD0 = 0, pinchK0 = 1;
  const ctx = canvas.getContext("2d");

  const toWorld = (px: number, py: number): { x: number; y: number } => ({ x: (px - view.x) / view.k, y: (py - view.y) / view.k });
  const resize = (): void => {
    const r = canvas.getBoundingClientRect();
    canvas.width = r.width * devicePixelRatio; canvas.height = r.height * devicePixelRatio;
    center = { x: r.width / 2, y: r.height / 2 };
  };

  const tick = (): void => {
    const n = nodes.length;
    for (let i = 0; i < n; i++) {
      const a = nodes[i];
      if (a.pinned) continue;
      let fx = (center.x - a.x) * 0.006, fy = (center.y - a.y) * 0.006;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const b = nodes[j], dx = a.x - b.x, dy = a.y - b.y, d2 = Math.max(900, dx * dx + dy * dy);
        fx += (dx / d2) * 260; fy += (dy / d2) * 260;
      }
      a.vx = (a.vx + fx) * 0.78; a.vy = (a.vy + fy) * 0.78;
      const sp = Math.hypot(a.vx, a.vy);
      if (sp > 8) { a.vx = (a.vx / sp) * 8; a.vy = (a.vy / sp) * 8; } // dampen the burst at simulation start
    }
    (graph?.links ?? []).forEach((l) => {
      const a = nodes.find((x) => x.id === l.source), b = nodes.find((x) => x.id === l.target);
      if (!a || !b) return;
      const dx = b.x - a.x, dy = b.y - a.y, dist = Math.hypot(dx, dy) || 1, f = (dist - 130) * 0.004;
      if (!a.pinned) { a.vx += (dx / dist) * f; a.vy += (dy / dist) * f; }
      if (!b.pinned) { b.vx -= (dx / dist) * f; b.vy -= (dy / dist) * f; }
    });
    nodes.forEach((a) => { if (!a.pinned) { a.x += a.vx; a.y += a.vy; } });
  };

  const draw = (): void => {
    if (!ctx || !canvas) return;
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.scale(devicePixelRatio, devicePixelRatio);
    ctx.translate(view.x, view.y);
    ctx.scale(view.k, view.k);
    ctx.lineWidth = 1.4 / view.k;
    ctx.strokeStyle = "rgba(29,28,36,.22)";
    (graph?.links ?? []).forEach((l) => {
      const a = nodes.find((x) => x.id === l.source), b = nodes.find((x) => x.id === l.target);
      if (!a || !b) return;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    });
    ctx.restore();
    // nodes and labels in screen coordinates: readable size at any zoom level
    ctx.save();
    ctx.scale(devicePixelRatio, devicePixelRatio);
    const deg = new Map<string, number>();
    (graph?.links ?? []).forEach((l) => { deg.set(l.source, (deg.get(l.source) ?? 0) + 1); deg.set(l.target, (deg.get(l.target) ?? 0) + 1); });
    ctx.font = "500 14px 'Bricolage Grotesque', sans-serif";
    ctx.textBaseline = "middle";
    nodes.forEach((a) => {
      const sx = a.x * view.k + view.x, sy = a.y * view.k + view.y, r = 6 + Math.min(6, (deg.get(a.id) ?? 0) * 1.2);
      ctx.beginPath();
      ctx.fillStyle = (GROUP_COLOR as Record<string, string>)[a.group] ?? "#282828";
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(29,28,36,.92)";
      ctx.fillText(a.title, sx + r + 7, sy);
    });
    ctx.restore();
  };

  const loop = (): void => { if (!alive) return; tick(); draw(); raf = requestAnimationFrame(loop); };

  const hit = (px: number, py: number): typeof nodes[number] | undefined => {
    const { x, y } = toWorld(px, py);
    return nodes.find((a) => Math.hypot(a.x - x, a.y - y) < 16 / view.k);
  };

  const pt = (e: PointerEvent): { x: number; y: number } => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  const onDown = (e: PointerEvent): void => {
    canvas.setPointerCapture(e.pointerId);
    const p = pt(e), h = hit(p.x, p.y);
    if (h) { drag = { id: h.id }; h.pinned = true; } else panStart = { x: p.x, y: p.y, vx: view.x, vy: view.y };
  };
  const onMove = (e: PointerEvent): void => {
    const p = pt(e);
    if (drag) {
      const w = toWorld(p.x, p.y), n = nodes.find((x) => x.id === drag!.id);
      if (n) { n.x = w.x; n.y = w.y; n.vx = 0; n.vy = 0; }
      return;
    }
    if (panStart) { view.x = panStart.vx + (p.x - panStart.x); view.y = panStart.vy + (p.y - panStart.y); return; }
    const h = hit(p.x, p.y);
    if (h && tip) { tip.textContent = h.title; tip.style.left = `${p.x + 14}px`; tip.style.top = `${p.y - 6}px`; tip.classList.add("show"); canvas.style.cursor = "pointer"; }
    else { tip?.classList.remove("show"); canvas.style.cursor = "grab"; }
  };
  const onUp = (e: PointerEvent): void => {
    const p = pt(e);
    if (drag && Math.hypot(p.x - (panStart?.x ?? p.x), p.y - (panStart?.y ?? p.y)) < 4) {
      const h = hit(p.x, p.y);
      if (h) location.hash = `crew-brain&node=${encodeURIComponent(h.id)}`;
    }
    if (drag) { const n = nodes.find((x) => x.id === drag!.id); if (n) n.pinned = false; }
    drag = null; panStart = null;
  };
  const onWheel = (e: WheelEvent): void => { e.preventDefault(); const k = Math.min(2.5, Math.max(0.4, view.k * (e.deltaY < 0 ? 1.08 : 0.93))); view.k = k; };
  let touches: Touch[] = [];
  const onTouch = (e: TouchEvent): void => {
    if (e.touches.length === 2) {
      const [a, b] = [e.touches[0], e.touches[1]], d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (touches.length !== 2) { pinchD0 = d; pinchK0 = view.k; } else view.k = Math.min(2.5, Math.max(0.4, pinchK0 * (d / pinchD0)));
      touches = [a as unknown as Touch, b as unknown as Touch];
      e.preventDefault();
    } else touches = [];
  };

  resize();
  const fitView = (): void => {
    if (!nodes.length) return;
    const xs = nodes.map((n) => n.x), ys = nodes.map((n) => n.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const r = canvas.getBoundingClientRect(), pad = 90;
    const k = Math.min(2.4, Math.max(0.3, Math.min((r.width - pad * 2) / Math.max(1, maxX - minX), (r.height - pad * 2) / Math.max(1, maxY - minY))));
    view = { k, x: r.width / 2 - ((minX + maxX) / 2) * k, y: r.height / 2 - ((minY + maxY) / 2) * k };
  };
  void fetch("/api/crew/brain/graph", { cache: "no-store" }).then((r) => (r.ok ? (r.json() as Promise<Graph>) : null)).then((g) => {
    if (!alive || !g) return;
    graph = g;
    nodes = g.nodes.map((n, i) => ({ ...n, x: center.x + Math.cos((i / g.nodes.length) * Math.PI * 2) * 110, y: center.y + Math.sin((i / g.nodes.length) * Math.PI * 2) * 110, vx: 0, vy: 0 }));
    for (let i = 0; i < 500; i++) tick(); // run the simulation ahead so the graph doesn't show mid-explosion
    fitView(); // fit the canvas even when it's wider than it is tall
  }).catch(() => undefined);

  addEventListener("resize", resize);
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("touchmove", onTouch, { passive: false });
  raf = requestAnimationFrame(loop);
  return () => {
    alive = false;
    cancelAnimationFrame(raf);
    removeEventListener("resize", resize);
    canvas.removeEventListener("pointerdown", onDown);
    canvas.removeEventListener("pointermove", onMove);
    canvas.removeEventListener("pointerup", onUp);
    canvas.removeEventListener("wheel", onWheel);
    canvas.removeEventListener("touchmove", onTouch);
  };
};

/* ---------- Home: dashboard widget data via a separate dash.ts module ---------- */
