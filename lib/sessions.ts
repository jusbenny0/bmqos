import "server-only";
import { randomBytes } from "node:crypto";
import { sql } from "./db";
import { authOff, COOKIE, sessionId, sessionMaxAge } from "./session";

/* Session as a DB row: can be revoked, has a step-up window and a failure counter. The cookie only carries a signed id. */
const IDLE_S = 7 * 24 * 3600, WINDOW_S = 600, MAX_FAILS = 5;
const now = (): number => Math.floor(Date.now() / 1000);
export interface Sess { id: string; ip: string; ua: string; stepup_until: number; fails: number }

export const clientIp = (req: Request): string => req.headers.get("x-forwarded-for")?.split(",").pop()?.trim() ?? "?";

export const newSession = (req: Request): string => {
  const id = randomBytes(16).toString("hex");
  sql().prepare("INSERT INTO session (id, created, last_seen, expires, ip, ua) VALUES (?,?,?,?,?,?)").run(id, now(), now(), now() + sessionMaxAge, clientIp(req), (req.headers.get("user-agent") ?? "").slice(0, 120));
  return id;
};

export const sessionOf = (req: Request): Sess | null => {
  if (authOff()) return { id: "local", ip: clientIp(req), ua: "", stepup_until: 0, fails: 0 }; // no-login mode
  const m = (req.headers.get("cookie") ?? "").match(new RegExp(`(?:^|; )${COOKIE}=([^;]+)`));
  const id = sessionId(m?.[1]);
  if (!id) return null;
  const r = sql().prepare("SELECT id, ip, ua, stepup_until, fails, last_seen, expires, revoked FROM session WHERE id = ?").get(id) as (Sess & { last_seen: number; expires: number; revoked: number }) | undefined;
  if (!r || r.revoked || r.expires < now() || r.last_seen < now() - IDLE_S) return null;
  sql().prepare("UPDATE session SET last_seen = ? WHERE id = ?").run(now(), id);
  return r;
};

export const revoke = (id: string): void => { sql().prepare("UPDATE session SET revoked = 1, stepup_until = 0 WHERE id = ?").run(id); };
export const revokeOthers = (id: string): number => Number(sql().prepare("UPDATE session SET revoked = 1, stepup_until = 0 WHERE id != ? AND revoked = 0").run(id).changes);
export const openWindow = (id: string): number => { const u = now() + WINDOW_S; sql().prepare("UPDATE session SET stepup_until = ?, fails = 0 WHERE id = ?").run(u, id); return u; };
export const windowOpen = (s: Sess): boolean => s.stepup_until > now();
// wrong code: revoke the session after the 5th (a fresh login = login rate-limit)
export const fail = (id: string): boolean => {
  sql().prepare("UPDATE session SET fails = fails + 1 WHERE id = ?").run(id);
  const f = (sql().prepare("SELECT fails FROM session WHERE id = ?").get(id) as { fails: number }).fails;
  if (f >= MAX_FAILS) { revoke(id); return true; }
  return false;
};
