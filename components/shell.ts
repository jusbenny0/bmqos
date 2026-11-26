import { esc } from "@/lib/stage";

/* BMQOS navigation: 7 sections + More. `ready` = route exists; others show a placeholder screen until its layer delivers it. */
export interface Sub { r: string; n: string; ready: boolean }
export interface Sec { id: string; n: string; ic: string; r: string; subs?: Sub[]; routes: string[]; more?: boolean; hint: string }

const P = {
  home: "M3 10.5 12 3l9 7.5M5 9.5V21h5v-6h4v6h5V9.5",
  inbox: "M3 13l3-8h12l3 8v7H3zM3 13h5a4 4 0 0 0 8 0h5",
  work: "M4 6h16M4 12h16M4 18h10M18 16l2 2 3-4",
  proj: "M3 6a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  infra: "M4 5h16v5H4zM4 14h16v5H4zM8 7.5h.01M8 16.5h.01",
  code: "M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16",
  docs: "M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h7",
  grow: "M3 17l6-6 4 4 8-8M15 7h6v6",
  auto: "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18",
  cost: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v10M9.5 9.5c0-1 1-1.5 2.5-1.5s2.5.8 2.5 1.8-1 1.4-2.5 1.7-2.5.7-2.5 1.8 1 1.7 2.5 1.7 2.5-.5 2.5-1.5",
  audit: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4",
  set: "M4 7h10M18 7h2M4 17h2M10 17h10M16 4v6M8 14v6",
  bolt: "M13 3 5 14h6l-1 7 8-11h-6z",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5",
  chat: "M4 5h16v11H9l-5 4zM8 9.5h8M8 12.5h5",
  plus: "M12 5v14M5 12h14",
  reply: "M9 14 4 9l5-5M4 9h10a6 6 0 0 1 6 6v3",
  send: "M4 12 20 4l-4 16-4-7z",
  merge: "M6 4v10M18 10v6M6 14a4 4 0 0 0 4 4h4M6 4h.01M18 8h.01M18 18h.01",
  rocket: "M5 19c0-3 1-5 3-7l5-5c2-2 5-3 7-3 0 2-1 5-3 7l-5 5c-2 2-4 3-7 3zM9 15l-4 1 1-4M14 9h.01",
  disk: "M4 7c0-2 3.5-3 8-3s8 1 8 3-3.5 3-8 3-8-1-8-3zM4 7v10c0 2 3.5 3 8 3s8-1 8-3V7M4 12c0 2 3.5 3 8 3s8-1 8-3",
  stop: "M8 4h8l4 4v8l-4 4H8l-4-4V8zM9 9h6v6H9z",
  wake: "M12 3v6M7 6a8 8 0 1 0 10 0",
  mic: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM6 11a6 6 0 0 0 12 0M12 17v4",
  more: "M4 12h3M10.5 12h3M17 12h3",
  crew: "M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 21c0-4 3.5-7 8-7s8 3 8 7M19 4l1.5 1.5L19 7",
  brain: "M9 3a3 3 0 0 0-3 3v1a3 3 0 0 0-2 5 3 3 0 0 0 2 5v1a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM15 3a3 3 0 0 1 3 3v1a3 3 0 0 1 2 5 3 3 0 0 1-2 5v1a3 3 0 0 1-6 0",
};
export type Ic = keyof typeof P;
export const ico = (k: Ic, s = 20): string => `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${P[k]}"/></svg>`;

export const SECS: Sec[] = [
  { id: "home", n: "Home", ic: "home", r: "overview", routes: ["overview"], hint: "Stats and agent runs" },
  { id: "tasks", n: "Needs you", ic: "work", r: "waiting", routes: ["waiting", "flow", "runs", "agents", "tasks-hermes", "tasks-done", "tasks-snooze"], hint: "What's waiting on your decision" },
  { id: "goals", n: "Goals", ic: "grow", r: "crew-tasks", routes: ["crew-tasks"], hint: "Big goals and their progress" },
  { id: "brand", n: "Brand", ic: "docs", r: "brand", routes: ["brand"], hint: "Logo, colors, tone and images" },
  { id: "ideas", n: "Ideas", ic: "grow", r: "crew-ideas", routes: ["crew-ideas"], hint: "Rough idea → team discussion → tasks" },
  { id: "crew", n: "Team", ic: "crew", r: "crew-team", routes: ["crew-team", "crew-brain"], hint: "Agents and their instructions" },
  { id: "usage", n: "Spend", ic: "cost", r: "crew-usage", routes: ["crew-usage"], hint: "How much the company costs" },
  { id: "proj", n: "Projects", ic: "proj", r: "projects", routes: ["projects", "project", "docs", "social"], hint: "A card for every project" },
  { id: "ops", n: "Services", ic: "infra", r: "ops", routes: ["ops"], hint: "Sites and services" },
  { id: "srv", n: "Machines", ic: "disk", r: "servers", routes: ["servers"], hint: "Servers and disks" },
];
export const secOf = (r: string): Sec | undefined => SECS.find((s) => s.routes.includes(r));
export const where = (r: string): string => ({ overview: "Home", waiting: "Tasks · Needs you", flow: "Tasks · Running", "tasks-hermes": "Tasks · Assistant decided", "tasks-done": "Tasks · Done", "tasks-snooze": "Tasks · Snoozed", runs: "Tasks · Runs", agents: "Tasks · Agents", projects: "Projects", project: "Projects · Project", docs: "Projects · Documents", social: "Projects · Social", ops: "Operations · Services", servers: "Operations · Machines", "crew-team": "Company · Team", "crew-tasks": "Company · Tasks", "crew-usage": "Company · Usage", "crew-ideas": "Company · Ideas", brand: "Projects · Brand", "crew-brain": "Company · Brain" } as Record<string, string>)[r] ?? "BMQOS";

/* uniform badges: amber number = needs you, red = needs attention, lime dot = running; zero is never drawn */
interface Badges { [id: string]: { n: number; c: "amber" | "red" } | undefined }
export const badges = (n: number): Badges => ({ tasks: n ? { n, c: "amber" } : undefined });
const bd = (b: Badges[string]): string => (b ? `<span class="bdg ${b.c}">${b.n}</span>` : "");

export const rail = (n: number, route: string, stale: string | null, top = "", bottom = ""): string => {
  const b = badges(n), cur = secOf(route);
  const item = (s: Sec): string => {
    const on = cur?.id === s.id;
    const sub = s.subs ? `<div class="rsub">${s.subs.map((u) => { const o = u.r === route; return `<a href="#${u.r}" class="${o ? "on" : ""}"${o ? ' aria-current="page"' : ""}>${esc(u.n)}</a>`; }).join("")}</div>` : "";
    return `<a class="ri ${on ? "on" : ""}" href="#${s.r}" title="${esc(s.n)}" ${on && !s.subs ? 'aria-current="page"' : ""}>${ico(s.ic as Ic, 22)}<span class="rl">${esc(s.n)}</span>${bd(b[s.id])}</a>${sub}`;
  };
  const live = stale ? `<span class="dot r"></span><span class="rl">Data from ${esc(stale)}</span>` : `<span class="dot"></span><span class="rl">Everything live</span>`;
  return `<aside class="rail" aria-label="Navigation"><div class="rtop">${top}<nav>${SECS.map(item).join("")}</nav></div><div class="rbot">${bottom}<div class="rfoot">${live}</div></div></aside>`;
};

/* mobile: bottom bar with 4 items, badge only on Tasks */
export const tabbar = (n: number, route: string): string => {
  const b = badges(n), cur = secOf(route);
  return `<nav class="tbar" aria-label="Main">${SECS.map((s) => `<a href="#${s.r}" class="${cur?.id === s.id ? "on" : ""}">${ico(s.ic as Ic, 22)}<span>${esc(s.n)}</span>${bd(b[s.id])}</a>`).join("")}</nav>`;
};

/* subpage tabs below the heading (Tasks, Projects, Operations) */
export const subtabs = (route: string, counts: Record<string, number> = {}): string => {
  const s = secOf(route);
  return s?.subs ? `<nav class="subtabs" aria-label="${esc(s.n)}">${s.subs.map((u) => { const on = u.r === (route === "project" ? "projects" : route); return `<a href="#${u.r}" class="${on ? "on" : ""}"${on ? ' aria-current="page"' : ""}>${esc(u.n)}${counts[u.r] ? `<span class="cnt">${counts[u.r]}</span>` : ""}</a>`; }).join("")}</nav>` : "";
};

/* placeholder screen until it's filled with data (Tasks E3, Operations E1) */
export const soon = (title: string, lead: string, note: string): string => `<div class="empty"><h2>${esc(title)}</h2><p>${esc(lead)}</p><p class="note">${esc(note)}</p></div>`;
