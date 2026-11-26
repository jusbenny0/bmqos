// AI provider detection + role selection. Dependency-free on purpose: scripts/setup.mjs imports it directly.
// detect() touches no network except localhost, never blocks longer than DETECT_BUDGET_MS and never returns key values.
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type ProviderKind = "cli-subscription" | "api-key" | "local";
export type Provider = { id: string; kind: ProviderKind; available: boolean; detail: string };
export type DetectOpts = { env?: NodeJS.ProcessEnv; fetch?: typeof fetch; budgetMs?: number };

export const DETECT_BUDGET_MS = 3000;
const CLIS = ["claude", "agy", "gemini", "codex"];
const KEYS: [id: string, vars: string[]][] = [
  ["anthropic-api", ["ANTHROPIC_API_KEY"]], ["openai-api", ["OPENAI_API_KEY"]],
  ["gemini-api", ["GEMINI_API_KEY", "GOOGLE_API_KEY"]], ["openrouter-api", ["OPENROUTER_API_KEY"]],
];
const LOCAL: [id: string, url: string][] = [
  ["ollama", "http://127.0.0.1:11434/api/tags"], ["lmstudio", "http://127.0.0.1:1234/v1/models"],
];

function onPath(bin: string, env: NodeJS.ProcessEnv): boolean {
  const exts = process.platform === "win32" ? ["", ".exe", ".cmd"] : [""];
  return (env.PATH ?? "").split(path.delimiter).filter(Boolean).some((dir) =>
    exts.some((x) => { try { fs.accessSync(path.join(dir, bin + x), fs.constants.X_OK); return true; } catch { return false; } }));
}

function claudeLoggedIn(env: NodeJS.ProcessEnv, ms: number): Promise<boolean> {
  if (fs.existsSync(path.join(env.HOME ?? os.homedir(), ".claude", ".credentials.json"))) return Promise.resolve(true);
  return new Promise((resolve) => {
    try { execFile("claude", ["auth", "status"], { env, timeout: ms }, (err) => resolve(!err)); }
    catch { resolve(false); }
  });
}

async function localModels(f: typeof fetch, url: string, ms: number): Promise<string[] | null> {
  try {
    const res = await f(url, { signal: AbortSignal.timeout(ms) });
    if (!res.ok) return null;
    const j = (await res.json()) as { models?: { name?: string }[]; data?: { id?: string }[] };
    return [...(j.models ?? []).map((m) => m.name), ...(j.data ?? []).map((m) => m.id)].filter((n): n is string => typeof n === "string");
  } catch { return null; }
}

export async function detect(opts: DetectOpts = {}): Promise<Provider[]> {
  const env = opts.env ?? process.env, f = opts.fetch ?? fetch, ms = opts.budgetMs ?? DETECT_BUDGET_MS;
  const out: Provider[] = [];
  const timer = new Promise<never>((_, rej) => setTimeout(() => rej(new Error("budget")), ms).unref());
  const cli = CLIS.map(async (id): Promise<Provider> => {
    if (!onPath(id, env)) return { id, kind: "cli-subscription", available: false, detail: "not on PATH" };
    if (id !== "claude") return { id, kind: "cli-subscription", available: true, detail: "found on PATH" };
    const ok = await claudeLoggedIn(env, ms);
    return { id, kind: "cli-subscription", available: ok, detail: ok ? "logged in" : "on PATH, not logged in" };
  });
  const local = LOCAL.map(async ([id, url]): Promise<Provider> => {
    const m = await localModels(f, url, ms);
    return { id, kind: "local", available: m !== null, detail: m === null ? "not running" : m.length ? m.join(", ") : "running, no models" };
  });
  const settled = await Promise.race([Promise.all([...cli, ...local]), timer]).catch(() => null);
  if (settled) out.push(...settled);
  else for (const id of [...CLIS, ...LOCAL.map(([i]) => i)]) out.push({ id, kind: CLIS.includes(id) ? "cli-subscription" : "local", available: false, detail: "check timed out" });
  for (const [id, vars] of KEYS) {
    const v = vars.find((n) => (env[n] ?? "") !== "");
    out.push({ id, kind: "api-key", available: Boolean(v), detail: v ? `${v} is set` : `${vars.join(" / ")} not set` });
  }
  return out;
}

// ---- selection ----
export type Group = "planning" | "building" | "junior" | "checks";
export const GROUPS: Record<Group, string[]> = {
  planning: ["ceo"], building: ["builder", "designer"], junior: ["junior"], checks: ["reviewer", "security", "qa", "visual"],
};
// Only these have an engine runtime today; everything else is shown as "detected, not supported yet".
const RUNTIME: Record<string, "claude" | "agy"> = { claude: "claude", agy: "agy" };
const RANK: Record<ProviderKind, number> = { "cli-subscription": 0, "api-key": 1, local: 2 };
export const isSupported = (p: Provider) => p.available && p.id in RUNTIME;
export const supportNote = (p: Provider) => (p.available && !isSupported(p) ? "detected, not supported yet" : "");

/** Best usable provider id per group: Claude Code subscription > API key > local, then anything supported; "mock" if none. */
export function plan(found: Provider[]): Record<Group, string> {
  const usable = found.filter(isSupported).sort((a, b) => RANK[a.kind] - RANK[b.kind] || (a.id === "claude" ? -1 : 1));
  const best = usable[0]?.id ?? "mock";
  const cheap = usable.find((p) => p.id === "agy")?.id ?? best;
  return { planning: best, building: best, junior: cheap, checks: best };
}

type Role = { name: string; role: string; model: string; engine: "claude" | "agy" | "mock"; engine_model?: string; prompt: string; cwd?: string };
const AGY_MODEL = "gemini-3.8-flash-medium";

/** Apply a {group: providerId} choice to a role list (e.g. DEFAULT_TEAM); returns new RoleDef[]. */
export function buildRoles<T extends Role>(team: T[], choice: Record<Group, string>): T[] {
  return team.map((r) => {
    const g = (Object.keys(GROUPS) as Group[]).find((k) => GROUPS[k].includes(r.role));
    const id = g ? choice[g] : "claude";
    if (id === "agy") return { ...r, engine: "agy", engine_model: r.engine_model ?? AGY_MODEL };
    if (id === "claude") { const { engine_model: _drop, ...rest } = r; return { ...rest, engine: "claude" } as T; }
    return { ...r, engine: "mock" };
  });
}

/** Write roles JSON next to engineDir/data and point engineDir/.env at it. Returns the roles file path. */
export function write(engineDir: string, roles: unknown[]): string {
  const file = path.join(engineDir, "data", "roles.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(roles, null, 2) + "\n");
  const envFile = path.join(engineDir, ".env"), line = "CREW_ROLES_FILE=data/roles.json";
  const cur = fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8") : "";
  const next = /^CREW_ROLES_FILE=.*$/m.test(cur) ? cur.replace(/^CREW_ROLES_FILE=.*$/m, line) : cur + (cur && !cur.endsWith("\n") ? "\n" : "") + line + "\n";
  fs.writeFileSync(envFile, next);
  return file;
}
