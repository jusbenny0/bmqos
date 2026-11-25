import "server-only";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ISSUE } from "./inbox";
import { items } from "./items";
import { taskRows, type TaskRow } from "./paperclip";
import { PREVIEWS, REAL, realOf } from "./projects";

/* "Now" overview for mobile: project status (hub + Paperclip), what's waiting on the owner (max 3), previews. Read-only, no new client. */
export interface TedProject { name: string; stav: string; open: number; done: number; running: string[]; updatedAt: string | null }
export interface TedWait { id: string; issue: string | null; text: string; q: string | null; project: string; at: string; href: string; actions: { id: string; label: string }[] }
export interface Ted { at: string; projects: TedProject[]; waiting: TedWait[]; waitingTotal: number; previews: typeof PREVIEWS }

const HUBS = (): string => process.env.OS_HUBS_DIR ?? "";

/** first lines of the `## Status` block (no markdown), max 2 bullets and 300 chars */
export const stavOf = (md: string): string => {
  const m = /^## Stav[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(md);
  if (!m) return "";
  return m[1].split("\n").filter((l) => l.trim()).slice(0, 2).map((l) => l.replace(/^[-*]\s+/, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[`*_]/g, "").trim()).join(" · ").slice(0, 300);
};
const hubStav = (name: string, re: RegExp): string => {
  try {
    const f = readdirSync(HUBS()).find((x) => x.endsWith(".md") && !x.includes(".bak") && re.test(x.slice(0, -3)));
    return f ? stavOf(readFileSync(join(HUBS(), f), "utf8")) : "";
  } catch { return ""; }
};

export const projectsOf = (rows: TaskRow[], stav: (n: string, re: RegExp) => string = hubStav): TedProject[] =>
  REAL.flatMap((r) => {
    const mine = rows.filter((x) => realOf(x.title, x.project)?.n === r.n);
    const s = stav(r.n, r.re);
    if (!mine.length && !s) return [];
    const open = mine.filter((x) => x.status !== "done");
    return [{
      name: r.n, stav: s, open: open.length, done: mine.length - open.length,
      running: [...new Set(open.filter((x) => x.running && x.agent).map((x) => x.agent as string))],
      updatedAt: mine.map((x) => x.at).sort().at(-1) ?? null,
    }];
  });

export const ted = async (): Promise<Ted> => {
  const [rows, xs] = await Promise.all([taskRows().catch((): TaskRow[] => []), items()]);
  const wait = xs.filter((i) => i.state === "na-mne" && i.owner.kind === "you");
  return {
    at: new Date().toISOString(), projects: projectsOf(rows), previews: PREVIEWS, waitingTotal: wait.length,
    waiting: wait.slice(0, 3).map((i) => ({ id: i.id, issue: i.source === "paperclip" && ISSUE.test(i.id.slice(10)) ? i.id.slice(10) : null, text: i.text, q: i.q ?? null, project: i.project, at: i.at, href: i.href, actions: i.id.startsWith("card:") ? i.actions : [] })),
  };
};
