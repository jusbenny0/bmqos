import "server-only";
import { cards, CARD_TYPES } from "./cards";
import { sql } from "./db";
import { createIssueFor, taskRows, type TaskRow } from "./paperclip";
import { live as crewLive, tasks as crewTasks, team as crewTeam } from "./crew";
import { upstream } from "./social";
import { demoItems, demoOn } from "./demo";

/* One "thing" for the whole panel, wherever it came from. The truth stays in the original systems; the OS only stores Mine, cards, and snoozes. */
export type Source = "paperclip" | "pr" | "watch" | "card" | "mine" | "social" | "crew";
export type State = "na-mne" | "bezi" | "hotovo" | "odlozeno";
export type ItemType = "hori" | "verejne" | "penize" | "smer" | "obsah" | "klic" | "moje" | "agenti";
export type Owner = { kind: "you" | "hermes" | "agent"; name: string };
export interface Item {
  id: string; source: Source; owner: Owner; state: State; type: ItemType; project: string; text: string; q?: string; more?: number; next?: string;
  actions: { id: string; label: string }[]; href: string; at: string; decidedByHermes?: { rule: string; at: string };
}

/* ---------- Rule "whose is it" (pure function) ---------- */
export interface Thing { title: string; status: string; waitsHuman: boolean; assigneeUser: boolean; agent: string | null; at: string; ask?: string | null; deferred?: boolean }
export type Verdict = Pick<Item, "owner" | "state" | "type" | "decidedByHermes">;

const plain = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
// distinguishes only the TYPE of the owner's thing (never whose it is); order = priority, default "smer"
const OWNER_TYPES: [Exclude<ItemType, "moje" | "agenti">, RegExp][] = [
  ["hori", /\bhori\b|vypadek|spadl[aoy]?\b|nefunguje|incident|vypadl|\bis down\b|\boutage|not working|\bcrash/],
  ["klic", /\bklic|\btoken(y|u|em|s)?\b|heslo|password|api.?key|secret|2fa|credential/],
  ["penize", /platb|zaplat|faktur|\d\s*(kc|czk|eur|usd)\b|\$\s*\d|predplatn|rozpocet|budget|reklam|\bads\b|kampan|\bpay(ment)?s?\b|invoice|subscription|campaign/],
  ["verejne", /na ostro|produkc|zverejn|publikov|vydat\b|vydani|\blaunch|production|publish|\bgo live\b|\bon live\b|\bmerge\b.*\b(main|master)\b|\b(main|master)\b.*\bmerge\b/],
  ["obsah", /schval\w*.*(prispev|post\b|text|obsah|clanek|newsletter)|(prispev|post\b|text|obsah|clanek|newsletter).*schval|approve\w*.*(post\b|content|article|newsletter)|\bsocial/],
  ["smer", /rozhodn|\bsmer|strategi|priorit|decision|direction/],
];
// what the Assistant may resolve on its own - the rule name goes into the decision record
const HERMES: [string, RegExp][] = [
  ["review", /code review|\breview (layer|round|of)\b|kontrol/], ["QA", /\bqa\b|test v prohlizeci|browser test/], ["merge into working branch", /merge|\bpr\b|pull/],
  ["test deploy", /nasazen|deploy|preview|restart/],
];
export const NO_CARD = "no question for the owner";

/** Whose is it: an open card with questions for the owner, or assignment to a user = always the owner (type from the card's content, otherwise "smer"). Otherwise the Assistant only handles review/QA/merge/test deployment. */
export const whose = (t: Thing): Verdict => {
  const hermes = t.agent === "Hermes";
  if (t.status === "done" || t.status === "cancelled") {
    return { owner: hermes ? { kind: "hermes", name: "Assistant" } : { kind: "agent", name: t.agent ?? "agent" }, state: "hotovo", type: "agenti" };
  }
  if (t.ask != null || t.assigneeUser) {
    const x = plain(`${t.ask ?? ""} ${t.title}`);
    return { owner: { kind: "you", name: "You" }, state: t.deferred ? "odlozeno" : "na-mne", type: OWNER_TYPES.find(([, re]) => re.test(x))?.[0] ?? "smer" };
  }
  if (hermes) return { owner: { kind: "hermes", name: "Assistant" }, state: "bezi", type: "agenti" }; // a task assigned to the Assistant isn't the owner's
  if (t.waitsHuman) {
    const rule = HERMES.find(([, re]) => re.test(plain(t.title)))?.[0] ?? NO_CARD;
    return { owner: { kind: "hermes", name: "Assistant" }, state: "bezi", type: "agenti", decidedByHermes: { rule, at: t.at } };
  }
  return { owner: { kind: "agent", name: t.agent ?? "agent" }, state: "bezi", type: "agenti" };
};

/* ---------- sources ---------- */
const clean = (s: string): string => s.replace(/[`*_>]|^#+\s*/g, "").replace(/\s+/g, " ").trim();
const issueUrl = (id: string): string => process.env.PAPERCLIP_ISSUE_URL ? `${process.env.PAPERCLIP_ISSUE_URL}/${id}` : "";

const fromPaperclip = (r: TaskRow): Item => {
  const v = whose({ title: r.title, status: r.status, waitsHuman: r.waitsHuman, assigneeUser: r.assigneeUser, agent: r.agent, at: r.at, ask: r.ask, deferred: r.deferred });
  return {
    id: `paperclip:${r.identifier}`, source: "paperclip", ...v, project: r.project, text: clean(r.title), ...(r.q ? { q: clean(r.q), more: r.more } : {}),
    next: v.state === "na-mne" ? (r.q ? undefined : "Reply right here in BMQOS.") : v.state === "odlozeno" ? "Snoozed: you wrote \"not yet\"." : v.decidedByHermes ? (v.decidedByHermes.rule === NO_CARD ? "The Assistant will triage it; if it turns out to be your decision, it'll come back to you." : "The Assistant will handle it on its own.") : undefined,
    actions: v.state === "na-mne" ? [{ id: "open", label: "Open task" }] : [], href: issueUrl(r.identifier), at: r.at,
  };
};

interface Draft { id: string; kind: "post" | "reply"; text: string; createdAt: number }
// 18 drafts = one item (the badge counts it as 1); approving them one by one happens in the Social module
const socialDrafts = async (): Promise<Item[]> => {
  if (!process.env.SOCIAL_API_URL || !process.env.DRAFTS_API_TOKEN) return [];
  const r = await upstream("/api/drafts?status=pending");
  if (!r.ok) return [];
  const ds = (await r.json()) as Draft[];
  if (!ds.length) return [];
  return [{
    id: "social:pending", source: "social", owner: { kind: "you", name: "You" }, state: "na-mne", type: "obsah", project: "Social",
    text: `${ds.length} ${ds.length === 1 ? "post draft" : "post drafts"} awaiting approval`,
    next: "Approve, edit, or reject in Social.", actions: [{ id: "open", label: "Open Social" }], href: "/social", at: new Date(Math.max(...ds.map((d) => d.createdAt))).toISOString(),
  }];
};

const fromCards = (): Item[] => cards().map((c) => ({
  id: `card:${c.id}`, source: "card", owner: { kind: "you", name: "You" }, state: c.choice === null ? "na-mne" : "hotovo", type: c.type, project: c.project, text: clean(c.text),
  next: c.choice === null ? undefined : `Answer: ${c.options[c.choice - 1]}`,
  actions: c.choice === null ? c.options.map((label, i) => ({ id: String(i + 1), label })) : [], href: `/api/cards/${c.id}`, at: c.answered ?? c.created,
}));

interface MineRow { id: number; text: string; project: string; created: string; done: string | null; handed: string | null }
const fromMine = (): Item[] => (sql().prepare("SELECT * FROM mine ORDER BY id DESC LIMIT 300").all() as unknown as MineRow[]).map((m) => ({
  id: `mine:${m.id}`, source: "mine", owner: m.handed ? { kind: "hermes", name: "Assistant" } : { kind: "you", name: "You" },
  state: m.done ? "hotovo" : m.handed ? "bezi" : "na-mne", type: "moje", project: m.project, text: clean(m.text),
  next: m.handed ? `Handed to Assistant (${m.handed}).` : undefined,
  actions: m.done || m.handed ? [] : [{ id: "done", label: "Done" }, { id: "snooze", label: "Snooze" }, { id: "handoff", label: "Hand to Assistant" }],
  href: `/api/items?id=mine:${m.id}`, at: m.done ?? m.created,
}));

/** A thing snoozed by the owner (any source) belongs in Snoozed until the snooze expires. */
export const applySnooze = (xs: Item[], until: Map<string, number>, now: number): Item[] => xs.map((i) => {
  const u = until.get(i.id);
  return u && u > now && i.state !== "hotovo" ? { ...i, state: "odlozeno" as const, next: `Snoozed until ${new Date(u).toLocaleDateString("cs-CZ")}.` } : i;
});

/* Company Crew tasks in one inbox: blocked = Needs you (waiting on the owner's decision), in progress/review = Running,
   done within 7 days = Done. The detail opens the company task (#crew-tasks&id=N). */
const fromCrew = async (): Promise<Item[]> => {
  if (!crewLive()) return [];
  const [ts, team] = await Promise.all([crewTasks(), crewTeam().catch(() => [])]);
  const week = Date.now() - 7 * 86_400_000, utc = (x: string): number => Date.parse(x.replace(" ", "T") + "Z");
  return ts.filter((t) => t.status !== "done" || utc(t.updated_at ?? t.created_at) > week).map((t): Item => {
    const who = team.find((m) => m.id === t.owner_id)?.name ?? "CEO";
    const state: State = t.status === "blocked" ? "na-mne" : t.status === "done" ? "hotovo" : "bezi";
    const why = (t.handoff_note ?? "").replace(/\s+/g, " ").trim().slice(0, 240);
    return { id: `crew:${t.id}`, source: "crew", owner: state === "na-mne" ? { kind: "you", name: "You" } : { kind: "agent", name: who }, state, type: "agenti", project: "Company",
      text: t.title, q: state === "na-mne" ? `Task got stuck - decide how to proceed: ${t.title}` : undefined,
      next: state === "na-mne" ? (why ? `Why it's stuck: ${why}` : "The agent got stuck. Open the task and tell the CEO how to proceed.") : state === "bezi" ? `${who} is working on it.` : undefined,
      actions: [], href: `#crew-tasks&id=${t.id}`, at: new Date(utc(t.updated_at ?? t.created_at)).toISOString() };
  });
};

/** All things from every available source. PRs (`pulls()` from lib/github) and the watcher (`findings()` from lib/watch) will be added once the E1 connectors are merged. */
export const items = async (): Promise<Item[]> => {
  if (demoOn()) return demoItems();
  const [pc, soc, cw] = await Promise.all([
    // a Paperclip outage must not hide the owner's tasks: instead of empty, one "Needs you" item with a warning
    process.env.PAPERCLIP_API_URL ? taskRows().then((r) => r.map(fromPaperclip)).catch((e): Item[] => {
      console.warn("items: Paperclip", e);
      return [{ id: "paperclip:chyba", source: "paperclip", owner: { kind: "you", name: "You" }, state: "na-mne", type: "smer", project: "Company", text: "Can't load Paperclip - tasks from it won't show until the connection is restored", actions: [], href: process.env.PAPERCLIP_ISSUE_URL ?? "", at: new Date().toISOString() }];
    }) : Promise.resolve([]),
    socialDrafts().catch((e) => { console.warn("items: social", e); return []; }),
    fromCrew().catch((e): Item[] => { console.warn("items: crew", e); return []; }),
  ]);
  const until = new Map((sql().prepare("SELECT item, until FROM snooze").all() as unknown as { item: string; until: number }[]).map((r) => [r.item, r.until]));
  const now = Date.now();
  sql().prepare("DELETE FROM snooze WHERE until <= ?").run(now);
  return applySnooze([...fromCards(), ...fromMine(), ...soc, ...pc, ...cw], until, now).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
};

/* ---------- tab filter ---------- */
export const TABS = ["na-mne", "bezi", "hermes", "hotovo", "odlozeno"] as const;
export type Tab = (typeof TABS)[number];
export const filter = (xs: Item[], o: { tab?: Tab; project?: string; type?: string; q?: string }): Item[] => {
  const q = o.q ? plain(o.q) : "";
  return xs.filter((i) =>
    (!o.tab || (o.tab === "hermes" ? !!i.decidedByHermes && i.state !== "odlozeno" : o.tab === "bezi" ? i.state === "bezi" && !i.decidedByHermes : i.state === o.tab))
    && (!o.project || i.project === o.project) && (!o.type || i.type === o.type)
    && (!q || plain(`${i.text} ${i.project} ${i.owner.name}`).includes(q)));
};
export const TYPES: string[] = [...CARD_TYPES, "moje", "agenti"];

/* ---------- My tasks and snoozing ---------- */
export const addMine = (text: string, project = "Company"): number =>
  Number(sql().prepare("INSERT INTO mine (text,project,created) VALUES (?,?,?)").run(text, project, new Date().toISOString()).lastInsertRowid);
export const doneMine = (id: number): boolean => Number(sql().prepare("UPDATE mine SET done = ? WHERE id = ? AND done IS NULL").run(new Date().toISOString(), id).changes) === 1;
/** Snoozing applies to any Item.id; `until` is an ms epoch in the future. */
export const snooze = (item: string, until: number): void => { sql().prepare("INSERT INTO snooze (item, until) VALUES (?,?) ON CONFLICT(item) DO UPDATE SET until = excluded.until").run(item, until); };
export const mineById = (id: number): MineRow | null => (sql().prepare("SELECT * FROM mine WHERE id = ?").get(id) as unknown as MineRow | undefined) ?? null;
// handoff to Hermes: a Paperclip task for Hermes; the Mine entry gets marked as handed off
export const handoff = async (id: number): Promise<string> => {
  const m = mineById(id);
  // lock: a double click won't create a second task
  if (!m || m.done || Number(sql().prepare("UPDATE mine SET handed = 'pending' WHERE id = ? AND handed IS NULL").run(id).changes) !== 1) throw new Error("couldn't hand off");
  const ident = await createIssueFor("Hermes", clean(m.text).slice(0, 120), `The owner's task from BMQOS (Mine #${id}), do this for them.\n\n${m.text}`).catch((e) => { sql().prepare("UPDATE mine SET handed = NULL WHERE id = ?").run(id); throw e; });
  sql().prepare("UPDATE mine SET handed = ? WHERE id = ?").run(ident, id);
  return ident;
};
