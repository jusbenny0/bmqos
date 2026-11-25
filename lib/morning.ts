import "server-only";
import { sql } from "./db";
import { items, type Item } from "./items";
import { services } from "./services";

/* Morning card: once a day after 8:30 (Prague) a summary of the night since 18:00. Info only, not an Item,
   so it never bumps the Needs you badge. One row per day in the `morning` table = idempotent across restarts. */
export interface Morning { day: string; since: string; done: string[]; fire: { t: string; solved: boolean }[]; down: number; waiting: number }

const TZ = "Europe/Prague";
export const dayOf = (d: Date): string => d.toLocaleDateString("sv-SE", { timeZone: TZ });
const minutes = (d: Date): number => { const [h, m] = d.toLocaleTimeString("cs-CZ", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).split(":").map(Number); return h * 60 + m; };
/** Yesterday 18:00 Prague (ms). */
export const sinceOf = (now: Date): number => {
  const t = now.getTime() - minutes(now) * 60_000 - 6 * 3_600_000; // today 0:00 minus 6 h = yesterday 18:00, accurate across DST shifts
  let x = new Date(t - (t % 60_000));
  while (minutes(x) !== 18 * 60) x = new Date(x.getTime() + (minutes(x) < 18 * 60 ? 1 : -1) * 60_000);
  return x.getTime();
};

const clip = (s: string): string => (s.replace(/^[^:·]{0,40}·\s*/, "").replace(/^[A-Z]{2,6}-\d+\s*[:·-]?\s*/, "") || s).slice(0, 90);

/** Pure function: summary of items since `since` (ms). */
export const build = (xs: Item[], since: number, now: Date, down = 0): Morning => {
  const fresh = xs.filter((i) => Date.parse(i.at) >= since);
  return {
    day: dayOf(now), since: new Date(since).toISOString(),
    done: fresh.filter((i) => i.state === "hotovo").map((i) => clip(i.text)).slice(0, 5),
    fire: fresh.filter((i) => i.type === "hori").map((i) => ({ t: clip(i.text), solved: i.state === "hotovo" || i.owner.kind !== "you" })).slice(0, 5),
    down,
    waiting: fresh.filter((i) => i.state === "na-mne" && i.owner.kind === "you").length,
  };
};

export const get = (day: string): { card: Morning; dismissed: boolean } | null => {
  const r = sql().prepare("SELECT body, dismissed FROM morning WHERE day = ?").get(day) as { body: string; dismissed: number } | undefined;
  return r ? { card: JSON.parse(r.body) as Morning, dismissed: !!r.dismissed } : null;
};
export const dismiss = (day: string): void => { sql().prepare("UPDATE morning SET dismissed = 1 WHERE day = ?").run(day); };

/** Called by instrumentation every minute; builds the card at most once a day, earliest at 8:30. */
export const tick = async (now: Date = new Date(), load: () => Promise<Item[]> = items, down: () => Promise<number> = async () => (await services()).filter((s) => !s.up).length): Promise<boolean> => {
  const day = dayOf(now);
  if (minutes(now) < 8 * 60 + 30 || get(day)) return false;
  const card = build(await load(), sinceOf(now), now, await down().catch(() => 0));
  return Number(sql().prepare("INSERT OR IGNORE INTO morning (day, body, dismissed) VALUES (?,?,0)").run(day, JSON.stringify(card)).changes) === 1;
};
