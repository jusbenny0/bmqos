import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { sql } from "./db";

// Instance configuration stored in SQLite (table config). Written by the onboarding wizard; read by layout, demo data and the Crew client.
export interface Company { name: string; accent: string; owner: string }
export interface AgentCfg { name: string; role: string }
export interface Engine { mode: "demo" | "crew"; url: string; token: string }
export interface Goal { model: string; limit: number; goal: string; task: string }
export interface Setup { company: Company; agents: AgentCfg[]; engine: Engine; goal: Goal }

export const TEMPLATE: AgentCfg[] = [
  { name: "Planner", role: "Plans and assigns work" },
  { name: "Builder", role: "Builds features" },
  { name: "Reviewer", role: "Reviews code and checks quality" },
  { name: "Assistant", role: "Summaries and reports for the owner" },
];
export const DEFAULT_ACCENT = "#059669";

const ready = (): void => { sql().exec("CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL)"); };
export const getConfig = <T>(key: string): T | null => {
  ready();
  const r = sql().prepare("SELECT value FROM config WHERE key = ?").get(key) as { value: string } | undefined;
  try { return r ? (JSON.parse(r.value) as T) : null; } catch { return null; }
};
export const setConfig = (key: string, v: unknown): void => {
  ready();
  sql().prepare("INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, JSON.stringify(v));
};

// "done" = wizard completed, "demo" = skipped to demo mode, null = first run
export const onboarded = (): "done" | "demo" | null => getConfig<"done" | "demo">("onboarded");
export const company = (): Company | null => getConfig<Company>("company");
export const crewConn = (): { url: string; token: string } | null => {
  const url = process.env.CREW_API_URL, token = process.env.CREW_API_TOKEN;
  if (url && token) return { url, token };
  const e = getConfig<Engine>("engine");
  return e?.mode === "crew" && e.url && e.token ? { url: e.url, token: e.token } : null;
};

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
// Validates the wizard payload; returns null when something required is missing or malformed
export const parseSetup = (b: unknown): Setup | null => {
  const o = (b ?? {}) as Record<string, unknown>, c = (o.company ?? {}) as Record<string, unknown>;
  const e = (o.engine ?? {}) as Record<string, unknown>, g = (o.goal ?? {}) as Record<string, unknown>;
  const name = str(c.name, 60);
  const accent = str(c.accent, 7);
  const agents = (Array.isArray(o.agents) ? o.agents : []).slice(0, 12)
    .map((a) => ({ name: str((a as AgentCfg)?.name, 40), role: str((a as AgentCfg)?.role, 80) })).filter((a) => a.name);
  if (!name || !/^#[0-9a-f]{6}$/i.test(accent || DEFAULT_ACCENT) || !agents.length) return null;
  const mode = e.mode === "crew" ? "crew" : "demo";
  const url = str(e.url, 200), token = str(e.token, 200);
  if (mode === "crew" && (!/^https?:\/\//.test(url) || !token)) return null;
  const limit = Math.max(0, Math.min(1e9, Number(g.limit) || 0));
  return {
    company: { name, accent: accent || DEFAULT_ACCENT, owner: str(c.owner, 60) },
    agents, engine: { mode, url: mode === "crew" ? url : "", token: mode === "crew" ? token : "" },
    goal: { model: str(g.model, 40) || "sonnet", limit, goal: str(g.goal, 300), task: str(g.task, 300) },
  };
};
export const saveSetup = (s: Setup): void => {
  setConfig("company", s.company); setConfig("agents", s.agents); setConfig("engine", s.engine); setConfig("goal", s.goal); setConfig("onboarded", "done");
};
export const skipSetup = (): void => setConfig("onboarded", "demo");

// Password step: nothing secret is stored in the DB. Returns the .env lines to paste (OS_AUTH=password enables the login).
export const authEnv = (password: string, totpSecret?: string): string => {
  const salt = randomBytes(16);
  return `OS_AUTH=password\nOS_PASSWORD_HASH=scrypt:${salt.toString("hex")}:${scryptSync(password, salt, 32).toString("hex")}\nOS_SESSION_SECRET=${randomBytes(32).toString("hex")}${totpSecret ? `\nOS_TOTP_SECRET=${totpSecret}` : ""}`;
};

// First-run guard (optional): set OS_SETUP_TOKEN on a public instance so only someone who knows it can run the setup.
// Without it the setup is open – same as the rest of the app in the default no-login mode.
export const setupNeedsCode = (): boolean => !!process.env.OS_SETUP_TOKEN;
export const setupOk = (got: string | null): boolean => {
  const want = process.env.OS_SETUP_TOKEN;
  if (!want) return true;
  const a = Buffer.from(got ?? ""), b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
};
