import "server-only";
import { createHash } from "node:crypto";
import * as webpush from "web-push";
import type { PushSubscription } from "web-push";
import { append } from "./audit";
import { sql } from "./db";
import { items, type Item } from "./items";
import { PREVIEWS, realOf } from "./projects";

/* Web push. Content is just kind + ID, no task text. VAPID keys from env. */
export type Mode = "push" | "quiet" | "off";
export const CATS: { id: string; name: string; hint: string; def: Mode }[] = [
  { id: "na-mne", name: "New item in Needs you", hint: "something waits for your decision", def: "push" },
  { id: "hori", name: "Needs attention", hint: "goes through even in quiet hours 22:30–7:30", def: "push" },
  { id: "hotovo", name: "Done, ready to check", hint: "a finished item in a project with a preview", def: "push" },
];
const LABEL: Record<string, string> = { "na-mne": "Needs you", hori: "Needs attention", hotovo: "Done, ready to check", souhrn: "Summary" };

export const configured = (): boolean => !!process.env.VAPID_PUBLIC && !!process.env.VAPID_PRIVATE;
export const publicKey = (): string => process.env.VAPID_PUBLIC ?? "";
const init = (): void => webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? "http://localhost:3000", publicKey(), process.env.VAPID_PRIVATE ?? "");

export const prefs = (): Record<string, Mode> => {
  const saved = new Map(sql().prepare("SELECT cat, mode FROM push_pref").all().map((r) => [String(r.cat), String(r.mode) as Mode]));
  return Object.fromEntries(CATS.map((c) => [c.id, saved.get(c.id) ?? c.def]));
};
export const setPref = (cat: string, mode: string): boolean => {
  if (!CATS.some((c) => c.id === cat) || !["push", "quiet", "off"].includes(mode)) return false;
  sql().prepare("INSERT OR REPLACE INTO push_pref VALUES (?,?)").run(cat, mode);
  return true;
};
export const hashOf = (endpoint: string): string => createHash("sha256").update(endpoint).digest("hex").slice(0, 32);
export const devices = (): { endpoint: string; id: string; ua: string; at: string }[] =>
  sql().prepare("SELECT endpoint, ua, at FROM push_sub ORDER BY at DESC").all().map((r) => ({ endpoint: String(r.endpoint).slice(-24), id: hashOf(String(r.endpoint)), ua: String(r.ua), at: String(r.at) }));
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /\.push\.apple\.com$/, /\.notify\.windows\.com$/, /^updates\.push\.services\.mozilla\.com$/];
export const allowedEndpoint = (e: string): boolean => {
  try { const u = new URL(e); return u.protocol === "https:" && PUSH_HOSTS.some((r) => r.test(u.hostname)); } catch { return false; }
};
export const subscribe = (sub: PushSubscription, ua: string): void => {
  sql().prepare("INSERT OR REPLACE INTO push_sub VALUES (?,?,?,?)").run(sub.endpoint, JSON.stringify(sub), ua.slice(0, 120), new Date().toISOString());
};
export const unsubscribe = (endpoint: string): void => { sql().prepare("DELETE FROM push_sub WHERE endpoint = ?").run(endpoint); };
export const unsubscribeId = (id: string): void => { for (const d of sql().prepare("SELECT endpoint FROM push_sub").all()) if (hashOf(String(d.endpoint)) === id) unsubscribe(String(d.endpoint)); };

// quiet hours 22:30–7:30 (Prague); only the "error" category goes through
export const quietNow = (d: Date = new Date()): boolean => {
  const [h, m] = d.toLocaleTimeString("cs-CZ", { timeZone: "Europe/Prague", hour: "2-digit", minute: "2-digit", hour12: false }).split(":").map(Number);
  const t = h * 60 + m;
  return t >= 22 * 60 + 30 || t < 7 * 60 + 30;
};

/* snooze is per device, stored server-side next to push_sub; once it expires the row just stops applying */
export const SNOOZES = ["1h", "tomorrow"] as const;
export const snoozeUntil = (kind: (typeof SNOOZES)[number], now: Date = new Date()): number => {
  if (kind === "1h") return now.getTime() + 3600_000;
  const day = new Date(now.getTime() + 864e5).toLocaleDateString("sv-SE", { timeZone: "Europe/Prague" }); // tomorrow's date in Prague, 8:00 local time
  for (const off of ["+01:00", "+02:00"]) { const t = Date.parse(`${day}T08:00:00${off}`); if (new Date(t).toLocaleTimeString("cs-CZ", { timeZone: "Europe/Prague", hour: "2-digit", minute: "2-digit", hour12: false }) === "08:00") return t; }
  return now.getTime() + 864e5;
};
/** endpoint = one device; without it, all devices */
export const snooze = (kind: string, endpoint?: string, now: Date = new Date()): boolean => {
  if (!(SNOOZES as readonly string[]).includes(kind)) return false;
  const until = snoozeUntil(kind as (typeof SNOOZES)[number], now);
  const set = sql().prepare("INSERT OR REPLACE INTO push_snooze VALUES (?,?)");
  for (const r of sql().prepare("SELECT endpoint FROM push_sub").all()) if (!endpoint || r.endpoint === endpoint) set.run(String(r.endpoint), until);
  return true;
};
export const activeSubs = (now: number): { endpoint: string; sub: string }[] =>
  sql().prepare("SELECT endpoint, sub FROM push_sub WHERE endpoint NOT IN (SELECT endpoint FROM push_snooze WHERE until > ?)").all(now).map((r) => ({ endpoint: String(r.endpoint), sub: String(r.sub) }));

const send = async (payload: { title: string; body: string; url: string; tag: string; silent?: boolean }): Promise<number> => {
  init();
  let n = 0;
  for (const r of activeSubs(Date.now())) {
    try { await webpush.sendNotification(JSON.parse(String(r.sub)) as PushSubscription, JSON.stringify(payload), { TTL: 3600 }); n++; }
    catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) unsubscribe(String(r.endpoint)); // unsubscribed in the browser
    }
  }
  return n;
};
export const sendTest = (): Promise<number> => send({ title: "BMQOS", body: "Test notification. It works.", url: "/#settings", tag: "test" });

/* Push only has two kinds: "needs you" (new owner item; Needs attention has its own category) and "done, ready to check"
   (item finished in the past 24 h in a project that has a preview in lib/ted PREVIEWS). Content is just kind + ID. */
export const eligible = (xs: Item[], now: number = Date.now()): { id: string; cat: string }[] =>
  xs.flatMap((i) => {
    if (i.state === "na-mne" && i.owner.kind === "you") return [{ id: i.id, cat: i.type === "hori" ? "hori" : "na-mne" }];
    if (i.state === "hotovo" && i.source === "paperclip" && PREVIEWS.some((p) => p.project === realOf(i.text, i.project)?.n) && now - Date.parse(i.at) < 864e5) return [{ id: i.id, cat: "hotovo" }];
    return [];
  });
export const fresh = (xs: Item[], seen: Set<string>, now: number = Date.now()): { id: string; cat: string }[] => eligible(xs, now).filter((x) => !seen.has(x.id));

/* summary at most twice a day (8:00 and 17:00 Prague, outside quiet hours); once per slot, slot stored in push_seen as `digest:<day>:<am|pm>` */
export const digestSlot = (now: Date): string | null => {
  const [h] = now.toLocaleTimeString("cs-CZ", { timeZone: "Europe/Prague", hour: "2-digit", minute: "2-digit", hour12: false }).split(":").map(Number);
  const day = now.toLocaleDateString("sv-SE", { timeZone: "Europe/Prague" });
  return h >= 17 && h < 22 ? `digest:${day}:pm` : h >= 8 && h < 17 ? `digest:${day}:am` : null;
};

/* the first run after process start just remembers state (in-memory `primed`, not an empty push_seen);
   during quiet hours a "needs attention" item isn't recorded so it still pings in the morning; "Quiet" = silent: true in the payload */
let primed = false;
type Payload = Parameters<typeof send>[0];
export const tick = async (now: Date = new Date(), load: () => Promise<Item[]> = items, deliver: (p: Payload) => Promise<number> = send): Promise<void> => {
  if (!configured()) return;
  const xs = await load();
  const db = sql();
  const seen = new Set(db.prepare("SELECT id FROM push_seen").all().map((r) => String(r.id)));
  const first = !primed;
  primed = true;
  const p = prefs(), quiet = quietNow(now);
  for (const x of fresh(xs, seen, now.getTime())) {
    if (!first && quiet && x.cat !== "hori") continue;
    db.prepare("INSERT OR IGNORE INTO push_seen VALUES (?,?)").run(x.id, new Date().toISOString());
    if (first || p[x.cat] === "off") continue;
    if (await deliver({ title: LABEL[x.cat], body: x.id, url: `/#waiting&item=${encodeURIComponent(x.id)}`, tag: x.id, silent: p[x.cat] === "quiet" })) append({ actor: "os", action: "push.send", tier: 1, target: x.id, status: "ok", result: x.cat });
  }
  const slot = digestSlot(now);
  if (slot && !first && !seen.has(slot) && p["na-mne"] !== "off") {
    db.prepare("INSERT OR IGNORE INTO push_seen VALUES (?,?)").run(slot, new Date().toISOString());
    const n = xs.filter((i) => i.state === "na-mne" && i.owner.kind === "you").length;
    if (n) await deliver({ title: LABEL.souhrn, body: `Needs you: ${n}`, url: "/#ted", tag: "souhrn", silent: p["na-mne"] === "quiet" });
  }
  const live = new Set([...eligible(xs, now.getTime()).map((x) => x.id), ...(slot ? [slot] : [])]);
  for (const id of seen) if (!live.has(id)) db.prepare("DELETE FROM push_seen WHERE id = ?").run(id);
};
