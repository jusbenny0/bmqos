import { esc } from "@/lib/stage";
import type { Item } from "@/lib/items";
import type { Snapshot } from "@/lib/types";
import type { Gate } from "@/lib/tasks";

/* Tasks: one list of things, five tabs. Data from GET /api/items, writes go through act() in os.tsx. */
export interface ItemsData { n: number; tab: string; list: Item[]; err?: boolean }

/* New task for an agent + review results: options from GET /api/tasks, verdicts from GET /api/tasks/review */
export interface TaskOpts { write: boolean; agents: { id: string; name: string }[]; projects: { id: string; name: string }[]; priorities: string[] }
export interface TaskDraft { title: string; agent: string; project: string; priority: string; zadani: string }
export interface TaskUi { opts: TaskOpts | null; draft?: TaskDraft; rv: { id: string; gates: Gate[] | null; err?: boolean } | null }
const PRIO: Record<string, string> = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };
const VERDICT: Record<string, string> = { projde: "Pass", zmeny: "Changes", neprojde: "Fail", neznamy: "No verdict" };
const opt = (xs: { id: string; name: string }[], sel = ""): string => xs.map((x) => `<option value="${esc(x.id)}"${x.name === sel ? " selected" : ""}>${esc(x.name)}</option>`).join("");

const newTask = (o: TaskOpts | null, d?: TaskDraft): string => !o ? "" : `<details class="ntask"${d ? " open" : ""}><summary>Give task to agent</summary>
 <form class="ctl" data-task-form>
  <label>Title<input name="title" placeholder="Task title" maxlength="200" value="${esc(d?.title ?? "")}" aria-label="Task title"><span class="err" data-err hidden>Enter a task title</span></label>
  <div class="trow"><label>To<select name="assigneeAgentId">${opt(o.agents, d?.agent ?? "CTO")}</select></label><label>Project<select name="projectId">${opt(o.projects, d?.project)}</select></label><label>Priority<select name="priority">${o.priorities.map((p) => `<option value="${p}"${p === (d?.priority ?? "medium") ? " selected" : ""}>${PRIO[p] ?? p}</option>`).join("")}</select></label></div>
  <textarea name="zadani" rows="5" placeholder="Brief (saved verbatim as the zadani document)" maxlength="50000" aria-label="Brief">${esc(d?.zadani ?? "")}</textarea>
  <div class="ctlrow"><button class="cta" type="submit">Submit task</button>${o.write ? "" : `<span class="hint">Writing to Paperclip is turned off; the task will only be saved as a draft.</span>`}</div>
 </form></details>`;

const review = (id: string, t: TaskUi): string => {
  const ident = id.replace(/^paperclip:/, "");
  if (!/^paperclip:/.test(id)) return "";
  if (t.rv?.id !== ident) return `<div class="ctlrow"><button class="cta ghost" data-rv="${esc(ident)}">Review results</button></div>`;
  if (t.rv.err) return `<div class="hint">Couldn't load the review results. <button class="cta" data-rv="${esc(ident)}">Try again</button></div>`;
  if (!t.rv.gates) return `<div class="hint">Loading review results…</div>`;
  if (!t.rv.gates.length) return `<div class="hint">No gate (Visual Critic, QA, Judge, Code Reviewer) has a verdict yet.</div>`;
  return `<div class="rv"><div class="lbl">Review results</div>${t.rv.gates.map((g) => `<div class="rvr"><div><b>${esc(g.gate)}</b> <span class="tag ${g.verdict === "projde" ? "l" : g.verdict === "neprojde" ? "r" : "a"}">${VERDICT[g.verdict]}${g.score !== null ? ` · ${g.score}/10` : ""}</span> <span class="hint">${esc(g.issue)} · ${ago(g.at)}</span></div>${g.excerpt ? `<div class="hint">${esc(g.excerpt.replace(/^(Gate|Judge|QA|Visual Critic|Code Reviewer):\s*/, ""))}</div>` : ""}${g.shots.some((u) => /^https?:/.test(u)) ? `<div class="rvs">${g.shots.filter((u) => /^https?:/.test(u)).map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(u.split("/").pop() ?? u)}</a>`).join("")}</div>` : ""}</div>`).join("")}</div>`;
};

export const TAB_OF: Record<string, string> = { waiting: "na-mne", flow: "bezi", "tasks-hermes": "hermes", "tasks-done": "hotovo", "tasks-snooze": "odlozeno" };

export const TYPE: Record<string, string> = { hori: "Needs attention", verejne: "Public", penize: "Money", smer: "Direction", obsah: "Content", klic: "Your key", moje: "Mine", agenti: "Agent work" };
const SOURCE: Record<string, string> = { paperclip: "Paperclip task", pr: "Pull request", watch: "Watcher", card: "Question from Assistant", mine: "Your task", social: "Social draft", crew: "Company task" };
const SENSITIVE = ["verejne", "penize", "klic"];
const EMPTY: Record<string, [string, string]> = {
  "na-mne": ["Nothing is waiting for you", "Agents and the Assistant work on their own. When they need your decision, it'll show up here."],
  bezi: ["No one is doing anything right now", "Here you'll see what agents are currently working on, by project."],
  hermes: ["Assistant hasn't decided anything yet", "Here you'll see what the Assistant resolved on its own and by which rule."],
  hotovo: ["Nothing done yet", "Completed things and answered questions."],
  odlozeno: ["Nothing snoozed", "Things you snooze hide here and come back at the time you choose."],
};

const ago = (iso: string): string => {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return m < 1 ? "now" : m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`;
};

const row = (i: Item, sel: string): string =>
  `<li><button class="${i.id === sel ? "on" : ""}" data-item="${esc(i.id)}"><span class="t">${esc(i.text)}</span><span class="age">${ago(i.at)}</span><span class="m"><span class="tag ${i.state === "na-mne" ? "a" : ""}">${TYPE[i.type]}</span>${i.type === "moje" ? "" : `<span>${esc(i.owner.name)}</span>`}<span>${esc(i.project)}</span></span></button></li>`;

const list = (tab: string, xs: Item[], sel: string): string => {
  if (tab !== "bezi") return `<ul class="wl">${xs.map((i) => row(i, sel)).join("")}</ul>`;
  const by = new Map<string, Item[]>();
  xs.forEach((i) => by.set(i.project, [...(by.get(i.project) ?? []), i]));
  return [...by].map(([p, g]) => `<div class="grp lbl">${esc(p)} · ${g.length}</div><ul class="wl">${g.map((i) => row(i, sel)).join("")}</ul>`).join("");
};

const button = (i: Item, a: Item["actions"][number]): string => {
  const num = /^card:/.test(i.id) ? ` data-v="${esc(a.id)}"` : "";
  if (a.id === "open") return `<a class="cta" href="#waiting&issue=${esc(i.id.replace(/^paperclip:/, ""))}">${esc(a.label)}</a>`;
  if (i.source === "social") return "";
  return `<button class="cta${a.id === "snooze" || a.id === "handoff" || (i.source === "card" && a.id !== "1") ? " ghost" : ""}" data-ia="${i.source === "card" ? "card" : a.id}" data-id="${esc(i.id)}"${num} data-msg="${esc(a.label)}">${esc(a.label)}</button>`;
};

const detail = (i: Item | undefined, tab: string, tk: TaskUi): string => {
  if (!i) return `<div class="dph"><h2>Select a task on the left</h2><p>The detail opens here.</p></div>`;
  const open = i.state === "na-mne" || i.state === "bezi";
  const sn = (days: number, label: string): string => `<button class="cta ghost" data-ia="snooze" data-id="${esc(i.id)}" data-days="${days}" data-msg="Snooze: ${label}">${label}</button>`;
  const acts = i.actions.filter((a) => a.id !== "snooze").map((a) => button(i, a)).join("") + (open ? sn(1, "Snooze until tomorrow") + sn(7, "For a week") : "")
    + (i.source === "social" ? `<a class="cta" href="#social">Open in Social</a>` : "")
    + (i.source === "crew" ? `<a class="cta" href="${esc(i.href)}">Open company task</a>` : "");
  const ext = ""; // Paperclip is just the engine running in the background: the owner handles everything in BMQOS, no outside link
  return `<div class="lbl"><span class="tag ${i.state === "na-mne" ? "a" : ""}">${TYPE[i.type]}</span><span>${esc(i.project)}</span></div>
 <h2>${esc(i.text)}</h2>
 ${i.next ? `<div class="why"><div class="hint">${esc(i.next)}</div></div>` : ""}
 ${i.decidedByHermes ? `<div class="hint">Decided by Assistant · rule: ${esc(i.decidedByHermes.rule)}</div>` : ""}
 <div class="kv"><div><span class="lbl">Owner</span><b>${esc(i.owner.name)}</b></div><div><span class="lbl">Source</span><b>${SOURCE[i.source]}</b></div><div><span class="lbl">Age</span><b>${ago(i.at)}</b></div></div>
 ${SENSITIVE.includes(i.type) && i.source === "card" && tab === "na-mne" ? `<div class="hint">Confirmation requires a 2FA code.</div>` : ""}
 <div class="ctl"><div class="ctlrow">${acts}${ext}</div></div>
 ${review(i.id, tk)}`;
};

export const itemsHTML = (d: ItemsData | null, route: string, sel: string | undefined, compact: boolean, snap?: Snapshot, tk: TaskUi = { opts: null, rv: null }): string => {
  const tab = TAB_OF[route];
  const xs = d && d.tab === tab ? d.list : null;
  const [et, el] = EMPTY[tab];
  const cur = xs?.find((i) => i.id === sel) ?? (compact ? undefined : xs?.[0]);
  const add = `<form class="add" data-add-form><input data-add name="t" placeholder="Add a task for yourself" maxlength="300" autocomplete="off" aria-label="Add task"><button class="cta" type="submit">Add</button></form>`;
  const body = d?.err && d.tab === tab ? `<div class="hint" style="padding:18px 24px">Couldn't load tasks. <button type="button" class="cta" data-itretry>Try again</button></div>` : xs === null ? `<div class="hint" style="padding:18px 24px">Loading…</div>` : xs.length ? list(tab, xs, cur?.id ?? "") : `<div class="empty"><h2>${et}</h2><p>${el}</p></div>`;
  const sheet = compact && cur ? `<div class="scrim" data-close></div><aside class="sheet" role="dialog" aria-label="${esc(cur.text)}"><div class="hd"><span class="lbl">Task</span><button class="x" data-close>Close ✕</button></div><div class="bd">${detail(cur, tab, tk)}</div></aside>` : "";
  return `<div class="screen page wp it"><div class="listc">${add}${tk.draft ? newTask(tk.opts, tk.draft) : ""}${body}</div><div class="detail">${xs?.length ? detail(cur, tab, tk) : xs && snap && tab === "na-mne" ? `<div class="dph"><h2>Select a task on the left</h2><p>The detail opens here.</p><small>Assistant resolving ${snap.kpi.failed} · Running ${snap.agents.filter((a) => a.st === "running").length} · <a href="#flow">What's running</a></small></div>` : xs ? `<div class="dph"><h2>Select a task on the left</h2><p>The detail opens here.</p></div>` : ""}</div></div>${sheet}`;
};

/** Tomorrow / in N days at 8:00 local time (ms epoch) - for snoozing. */
export const snoozeUntil = (days: number): number => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(8, 0, 0, 0); return d.getTime(); };
