import { esc } from "@/lib/stage";
import type { Snapshot } from "@/lib/types";
import { fires } from "@/lib/fires";
import { ico, type Ic } from "./shell";
import { TYPE } from "./mod/items";
import { crewDashHTML, loadCrewDash, loadTasksDash, usageDashHTML, loadUsageDash, runsDashHTML, statsHTML, composerHTML } from "./mod/dash";
import type { Item } from "@/lib/items";
import type { Morning } from "@/lib/morning";

const tidy = (t: string): string => t.replace(/^[^:·]{0,40}·\s*/, "").replace(/^[A-Z]{2,6}-\d+\s*[:·-]?\s*/, "") || t;

/* Home: one view of everything the owner needs – Needs you, Running employees, Company tasks,
   Vault/Brain, Ops, Spend. Paperclip-simplicity: dense, readable dashboard, no decoration. */
interface Tile { id: string; n: string; s: string; ic: Ic; k: string; n0?: number; red?: boolean; off?: boolean }

export const tiles = (d: Snapshot, soc: number): Tile[] => {
  const running = d.agents.filter((a) => a.st === "running").length;
  const paused = d.agents.filter((a) => a.st === "paused").length;
  const merge = d.wait.filter((w) => w.kind === "PR to merge").length;
  const stop: Tile = running || !paused
    ? { id: "stop", n: "Stop all", s: running ? `Pauses ${running} running agents` : "Nothing running", ic: "stop", k: "⇧S", red: !!running, off: !running }
    : { id: "wake", n: "Wake all", s: `Resumes ${paused} paused`, ic: "wake", k: "⇧S" };
  const all: (Tile | false)[] = [
    { id: "hermes", n: "Message the Assistant", s: "Panel on the right", ic: "chat", k: "H" },
    { id: "task", n: "New task", s: "One sentence, the Assistant breaks it down", ic: "plus", k: "N" },
    d.wait.length > 0 && { id: "reply", n: "Reply to next", s: "Oldest in Inbox", ic: "reply", k: "O", n0: d.wait.length },
    soc > 0 && { id: "posts", n: "Approve posts", s: "Queue for X", ic: "send", k: "P", n0: soc },
    merge > 0 && { id: "merge", n: "Merge ready", s: "PRs that passed review", ic: "merge", k: "M", n0: merge },
    { id: "deploy", n: "Deploy", s: "Pick a project, trigger redeploy", ic: "rocket", k: "D" },
    { id: "disks", n: "Clean up disks", s: "Servers and disk space", ic: "disk", k: "U" },
    stop,
  ];
  return all.filter((t): t is Tile => !!t);
};

const plural = (n: number, one: string, few: string, many: string): string => (n === 1 ? one : n >= 2 && n <= 4 ? few : many);
const chip = (t: Tile): string => `<button class="chip${t.red ? " red" : ""}"${t.off ? ' disabled title="Nothing running"' : ""} data-do="${t.id}" aria-keyshortcuts="${t.k}">${esc(t.n)}${t.n0 ? `<span class="bdg amber">${t.n0}</span>` : ""}<kbd>${esc(t.k)}</kbd></button>`;

/* Ops – one sentence + any findings; same register as Ops → Services (/api/services); 30s cache */
const CHEV = '<svg class="ic" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
let svc: { n: number; down: number } | null = null, svcAt = 0, svcBusy = false;
const opsHTML = (): string => !svc ? `<a class="oline" id="opsl" href="#ops"><i class="dot"></i>Checking services…${CHEV}</a>`
  : !svc.n ? '<span id="opsl" hidden></span>' /* we don't report an empty register: Ops may have data from other sources */
  : svc.down ? `<a class="oline warn" id="opsl" href="#ops"><i class="dot a"></i>${svc.down} of ${svc.n} services down${CHEV}</a>`
  : `<a class="oline ok" id="opsl" href="#ops"><i class="dot"></i>All ${svc.n} services are up${CHEV}</a>`;
export const opsLine = (): string => opsHTML();
/* loading outside render: called by os.tsx on entering Home; once loaded it only replaces #opsl + starts the dashboard widgets */
export const loadOps = (): void => {
  loadCrewDash();
  loadTasksDash();
  loadUsageDash();
  if (svcBusy || Date.now() - svcAt < 30_000) return;
  svcBusy = true;
  void fetch("/api/services", { cache: "no-store" }).then((r) => (r.ok ? (r.json() as Promise<{ services: { up: boolean }[] }>) : null))
    .then((j) => { if (j) svc = { n: j.services.length, down: j.services.filter((s) => !s.up).length }; })
    .catch(() => { svc = { n: 0, down: 0 }; })
    .finally(() => { svcBusy = false; svcAt = Date.now(); const el = document.getElementById("opsl"); if (el) el.outerHTML = opsHTML(); });
};

/* Morning card: informational, separate from the Needs-you badge. Loads with Home, closing = POST and it's gone until tomorrow. */
let morn: Morning | null = null;
const li = (t: string, mark = ""): string => `<li>${mark}${esc(t)}</li>`;
const mornHTML = (): string => {
  const m = morn;
  if (!m) return '<div id="morn" hidden></div>';
  const fire = m.fire.length || m.down
    ? [...m.fire.map((f) => li(f.t, `<b class="${f.solved ? "ok" : "no"}">${f.solved ? "Resolved" : "Waiting"}</b> `)), ...(m.down ? [li(`${m.down} ${plural(m.down, "service is down", "services are down", "services are down")} now`)] : [])].join("")
    : li("Nothing was on fire.");
  const sect = (l: string, body: string): string => `<div><div class="lbl">${l}</div><ul>${body}</ul></div>`;
  return `<section class="morn" id="morn" aria-label="What happened overnight"><div class="mh"><h2>What happened overnight</h2><button class="x" data-morn="x" aria-label="Close morning card">×</button></div>
<div class="mg">${sect("Finished", m.done.length ? m.done.slice(0, 3).map((t) => li(t)).join("") + (m.done.length > 3 ? li(`and ${m.done.length - 3} more`) : "") : li("Nothing finished."))}${sect("On fire", fire)}${sect("New for you", li(m.waiting ? `${m.waiting} ${plural(m.waiting, "new item", "new items", "new items")} in Tasks` : "Nothing new."))}</div></section>`;
};
export const loadMorning = (): void => {
  void fetch("/api/morning", { cache: "no-store" }).then((r) => (r.ok ? (r.json() as Promise<{ card: Morning | null }>) : null))
    .then((j) => { morn = j?.card ?? null; const el = document.getElementById("morn"); if (el) el.outerHTML = mornHTML(); }).catch(() => undefined);
};
if (typeof document !== "undefined") document.addEventListener("click", (e) => {
  if (!(e.target as Element).closest("[data-morn]")) return;
  morn = null; document.getElementById("morn")?.remove();
  void fetch("/api/morning", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => undefined);
});

/* Home = dashboard in one view: Needs you → Running employees → Company tasks → Vault/Brain → Ops → Spend.
   DOM order = priority order on mobile (stack); on desktop the grid in dash.css lays it out. */
export const home = (d: Snapshot, soc: number, hot = "", ix: { list: Item[] } | null = null): string => {
  const fire = fires(d);
  const cards = ix?.list ?? [];
  const n = cards.length;
  const h1 = `${!ix ? "Loading…" : n ? `${n} ${plural(n, "item is waiting", "items are waiting", "items are waiting")} for you.` : "Nothing is waiting for you."}<span>${fire.length ? `${fire.length} ${plural(fire.length, "item needs", "items need", "items need")} attention.` : "Nothing needs attention."}</span>`;
  const fcards = fire.map((f) => `<article class="hcard hot"><div class="kick"><i class="dot r"></i><span class="t">Needs attention</span></div><h2>${esc(f.t)}</h2><p>${esc(f.why)}</p><div class="acts"><button class="btn p" data-go="${esc(f.go)}">${esc(f.b)}</button></div></article>`).join("");
  const wcards = cards.slice(0, 4).map((w, i) => {
    const ext = /^https?:/.test(w.href);
    const btn = ext ? `<a class="btn p" href="${esc(w.href)}" target="_blank" rel="noopener noreferrer">Reply</a>` : `<button class="btn p" data-go="waiting&item=${encodeURIComponent(w.id)}">${w.source === "paperclip" ? "Reply" : "Decide"}</button>`;
    const lead = w.q ?? tidy(w.text);
    const sub = w.q ? tidy(w.text) : w.next ?? "";
    return `<article class="hcard" style="--i:${i}"><div class="kick"><span class="n">${i + 1}</span><i class="dot a"></i><span class="t">${esc(TYPE[w.type])}</span><span class="mono">${esc(w.project)}</span></div><h2 class="lead">${esc(lead)}</h2>${w.more || sub ? `<p class="of">${w.more ? `<b>and ${w.more} more</b>${sub ? " · " : ""}` : ""}${esc(sub)}</p>` : ""}<div class="acts">${btn}</div></article>`;
  }).join("");
  const rest = n > 4 ? `<a class="lnk" href="#waiting">${n - 4} more in Tasks</a>` : "";
  const empty = !ix || n || fire.length ? "" : `<div class="done"><span>Queue is empty. <b>Agents are working on their own.</b></span></div>`;
  const more = tiles(d, soc).filter((t) => !["hermes", "task", "reply"].includes(t.id));

  const story = !ix ? "Loading…" : n ? `${n} ${plural(n, "item is waiting", "items are waiting", "items are waiting")} for your decision.` : "Nothing is waiting for you – agents are running on their own.";
  /* Workflow top to bottom: give the CEO a task → see the numbers → watch agent runs → on the right what's waiting for you and who's working now → spend at the bottom */
  return `<div class="screen home dash"><div class="col">${hot}
<header class="d-hero"><div class="d-hero-t"><h1>Company overview</h1><p>${esc(story)}${fire.length ? ` <b class="hot">Needs attention: ${fire.length}.</b>` : ""}</p></div><div class="d-hero-in">${composerHTML()}</div></header>
<section class="dcard d-spend"><h2>Spend<a class="lnk" href="#crew-usage">Details</a></h2><div id="d-usage">${usageDashHTML()}</div></section>
<nav class="d-kpis" id="d-kpi" aria-label="Stats">${statsHTML()}</nav>
<div class="d-main">
<section class="dcard d-runscard"><h2>Agent runs<span class="d-live"><i></i>live</span><a class="lnk" href="#crew-tasks">All</a></h2>
<div class="run-h"><span>Status</span><span>Task · who worked on it</span><span>Cost · duration</span><span></span></div><div class="d-runs" id="d-runs">${runsDashHTML()}</div></section>
<div class="d-side">
<section class="dcard d-natebe"><h2>Needs you${n ? `<span class="d-badge">${n}</span>` : ""}<a class="lnk" href="#waiting">All</a></h2><div class="hcards">${fcards}${wcards}${empty}</div>${rest}</section>
<section class="dcard d-crewcard"><h2>Team<a class="lnk" href="#crew-team">Details</a></h2><div class="d-crewlist" id="d-crew">${crewDashHTML()}</div></section>
</div></div>
</div></div>`;
};
