import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// All deployment-specific settings come from the environment. Nothing here needs to be set to start:
// without a `claude` CLI on PATH the engine runs in mock mode (canned replies, full pipeline still works).
export type Engine = "claude" | "agy" | "mock";
export type RoleDef = {
  name: string;
  role: string; // ceo | builder | junior | designer | reviewer | security | visual | qa (pipeline roles); optional "advisor" is outside the pipeline, see lib/advisors.ts
  model: string; // claude CLI model alias or id (e.g. "sonnet", "haiku")
  engine: Engine; // claude CLI by default, agy (Antigravity CLI) optional
  engine_model?: string; // concrete model for non-claude engines
  prompt: string;
  cwd?: string;
  persona?: Persona; // optional personality, injected before the role instructions
};
export type Persona = { name?: string; tone: string; values: string[]; avoid: string[] };

// Presets live in engine/personas/*.json (generic archetypes, no real people).
export function loadPreset(id: string): Persona | undefined {
  for (const base of [path.join(process.cwd(), "personas"), path.join(process.cwd(), "engine", "personas")]) {
    try { return JSON.parse(fs.readFileSync(path.join(base, `${id}.json`), "utf8")) as Persona; } catch { /* next */ }
  }
}
export const listPresets = (): string[] => {
  for (const base of [path.join(process.cwd(), "personas"), path.join(process.cwd(), "engine", "personas")]) {
    try { return fs.readdirSync(base).filter((f) => f.endsWith(".json") && !f.startsWith("advisor-")).map((f) => f.slice(0, -5)).sort(); } catch { /* next */ }
  }
  return [];
};

// Validate an untrusted persona (API/roles file): strings and string lists only. null = invalid.
export function parsePersona(v: unknown): Persona | null {
  const o = v as Partial<Persona> | null;
  const list = (x: unknown) => Array.isArray(x) && x.every((i) => typeof i === "string");
  if (!o || typeof o !== "object" || typeof o.tone !== "string" || !list(o.values) || !list(o.avoid)) return null;
  if (o.name !== undefined && typeof o.name !== "string") return null;
  return { ...(o.name ? { name: o.name } : {}), tone: o.tone, values: o.values!, avoid: o.avoid! };
}

// Stored employees.persona (JSON text) -> Persona, null when empty or invalid.
export function personaOf(raw: string | null | undefined): Persona | null {
  try { return raw ? parsePersona(JSON.parse(raw)) : null; } catch { return null; }
}

export const PERSONA_MAX = 600;
// Short "Personality: ..." block for the system prompt, truncated to PERSONA_MAX chars. "" without a persona.
export function personaBlock(p: Persona | null | undefined): string {
  if (!p) return "";
  const parts = [p.name && `You are "${p.name}".`, p.tone && `Tone: ${p.tone}.`, p.values.length && `Values: ${p.values.join("; ")}.`, p.avoid.length && `Avoid: ${p.avoid.join("; ")}.`].filter(Boolean);
  if (!parts.length) return "";
  const t = `Personality: ${parts.join(" ")}`;
  return (t.length > PERSONA_MAX ? `${t.slice(0, PERSONA_MAX - 1).trimEnd()}…` : t) + "\n\n";
}

// Persona first, then the role instructions (which end with the retro lessons).
export const withPersona = (persona: Persona | null | undefined, systemPrompt: string): string => personaBlock(persona) + systemPrompt;

const int = (v: string | undefined, d: number) => (Number(v) > 0 ? Number(v) : d);

export const BASE_BRANCH = process.env.CREW_BASE_BRANCH || "main";
export const CREW_URL = process.env.CREW_URL || `http://127.0.0.1:${process.env.PORT || 3800}`;
export const CREW_TOKEN = process.env.CREW_TOKEN || "";
export const CEO_CWD = process.env.CREW_CEO_CWD || path.join(os.tmpdir(), "crew-ceo");
export const CONTEXT_WINDOW = int(process.env.CREW_CONTEXT_WINDOW, 200_000);
export const AGY_CONTEXT_WINDOW = int(process.env.CREW_AGY_CONTEXT_WINDOW, 1_000_000);
export const TIMEOUT_MS = int(process.env.CREW_TIMEOUT_MIN, 30) * 60_000;
export const BLOCKED_MODEL = process.env.CREW_BLOCKED_MODEL || "opus"; // regex; set to "^$" to allow everything

// Safe default limits (override per role in the roles JSON, or globally via env).
export const MAX_TURNS_DEFAULT = int(process.env.CREW_MAX_TURNS, 25);
export const MAX_TURNS_BY_ROLE: Record<string, number> = { builder: 40, reviewer: 15, qa: 25, visual: 30, security: 30, ceo: 10 };
export const RESET_AT_TOKENS_BY_ROLE: Record<string, number> = {
  ceo: int(process.env.CREW_CEO_RESET_TOKENS, 60_000), reviewer: 80_000, qa: 80_000, security: 80_000,
};
export const COMPACT_AT_DEFAULT = 60; // % of context window
export const COMPACT_AT_BY_ROLE: Record<string, number> = { ceo: 45 };
export const MAX_RETURNS = int(process.env.CREW_MAX_RETURNS, 2); // how often a gate may send work back to the builder
export const TOKEN_CAP_BY_SIZE: Record<string, number> = {
  S: int(process.env.CREW_CAP_S, 300_000), M: int(process.env.CREW_CAP_M, 800_000),
};

const VERDICT = 'End the reply with a last line that is exactly "VERDICT: APPROVED" or "VERDICT: RETURN" (with the reason above it).';
const BUILDER = `You are a builder (engineer). Your worktree (cwd) is an isolated checkout of the repo - do not touch anything outside it. ` +
  `At the START of a task create a new branch from the base branch (git fetch origin && git checkout -b agent/<short-topic> origin/${BASE_BRANCH}) so you do not collide with other work. ` +
  `Save limits: at most ~25 tool steps per run, combine shell commands, keep outputs short, read only the files you need, ` +
  `and use a subagent for larger reads (logs, diffs, many files). ` +
  `Finish with a commit + push (git push origin HEAD) + PR (gh pr create --base ${BASE_BRANCH}), or at least a handoff_note, otherwise the handoff to the reviewer fails.`;

const ROLE_PERSONA: Record<string, string> = {
  ceo: "careful-senior", builder: "careful-senior", designer: "careful-senior", junior: "fast-pragmatist",
  reviewer: "strict-reviewer", security: "strict-reviewer", visual: "strict-reviewer", qa: "strict-reviewer",
};

const TEAM: RoleDef[] = [
  { name: "CEO", role: "ceo", model: "sonnet", engine: "claude", prompt: "You are the CEO and planner of a small AI team. You break requests into tasks and delegate them to the team." },
  { name: "Builder A", role: "builder", model: "sonnet", engine: "claude", prompt: BUILDER },
  { name: "Builder B", role: "builder", model: "sonnet", engine: "claude", prompt: BUILDER },
  { name: "Junior", role: "junior", model: "haiku", engine: "agy", engine_model: "gemini-3.8-flash-medium",
    prompt: `You are the Junior builder (cheapest engine). You only get simple/mechanical tasks (small fixes, copy, renames, boilerplate, test scaffolding). ` +
      `Your worktree (cwd) is an isolated checkout. At the start create a branch from the base branch (git checkout -b agent/junior-<topic> origin/${BASE_BRANCH}). Keep outputs short. ` +
      `Finish with a commit + push (git push origin HEAD) + PR (gh pr create --base ${BASE_BRANCH}) or a handoff_note. Like every builder, your work always goes through the Reviewer.` },
  { name: "Reviewer", role: "reviewer", model: "haiku", engine: "claude",
    prompt: `You are the reviewer (cheap model). Check the diff/handoff_note against the task and decide. Do not read the whole repo - only the diff in the message. At most ~15 steps. ${VERDICT} Return work only for real defects, not style.` },
  { name: "Security", role: "security", model: "haiku", engine: "claude",
    prompt: `You are Security (cheap model, checklist-based). You get tasks the Reviewer approved that touch auth/session, secrets/env, payments, public API endpoints, file upload, dependencies or infra/deploy (needs_security=1), or where the automatic scan found a possible secret/vulnerability (the handoff says what). ` +
      `Check the diff against the checklist: secrets/keys in code, missing auth/validation on new endpoints, unsafe file upload handling, new dependencies with known CVEs, anything unsafe in infra/deploy config. Do not read the whole repo - only the diff. At most ~15 steps. ${VERDICT}` },
  { name: "Visual", role: "visual", model: "sonnet", engine: "claude",
    prompt: `You are the Visual critic. You get tasks that change the UI and were already approved by earlier gates (needs_visual=1). ` +
      `Take Playwright screenshots of the changed screens at widths 1440 and 390 (headless chromium), compare them with the task and the project's style reference. ` +
      `Be specific: element, problem, fix. At most ~15 steps; save screenshots to /tmp and describe them, do not attach binaries. ${VERDICT}` },
  { name: "QA", role: "qa", model: "haiku", engine: "claude",
    prompt: `You are QA (cheap model). You check ONLY UI/frontend tasks that earlier gates already approved and that have needs_qa=1. ` +
      `Review the diff/handoff_note against the task from the user's point of view: does the described flow work, is anything obviously broken (layout, missing state, console errors)? Only the diff, not the whole repo. At most ~10 steps. ${VERDICT}` },
];
export const DEFAULT_TEAM: RoleDef[] = TEAM.map((r) => ({ ...r, persona: loadPreset(ROLE_PERSONA[r.role] ?? "careful-senior") }));

// Roles are configurable: CREW_ROLES_FILE (path to a JSON array of RoleDef) or CREW_ROLES_JSON (inline JSON).
// A configured list replaces the default team. Seeding is idempotent by name and never overwrites existing employees.
export function loadTeam(): RoleDef[] {
  const file = process.env.CREW_ROLES_FILE;
  const raw = process.env.CREW_ROLES_JSON || (file ? fs.readFileSync(file, "utf8") : "");
  if (!raw) return DEFAULT_TEAM;
  const list = JSON.parse(raw) as RoleDef[];
  if (!Array.isArray(list) || list.length === 0) throw new Error("CREW_ROLES: expected a non-empty JSON array");
  for (const r of list) {
    if (!r.name || !r.role || !r.model || !["claude", "agy", "mock"].includes(r.engine ?? "claude")) throw new Error(`CREW_ROLES: invalid entry ${JSON.stringify(r.name ?? r)}`);
    r.engine ??= "claude";
    r.prompt ??= "";
    if (r.persona !== undefined && !(r.persona = parsePersona(r.persona) ?? undefined)) throw new Error(`CREW_ROLES: invalid persona for ${r.name}`);
  }
  return list;
}

export function claudeAvailable(): boolean {
  return (process.env.PATH ?? "").split(path.delimiter).some((d) => d && fs.existsSync(path.join(d, "claude")));
}
// mock when forced (CREW_MOCK=1), or when the engine's CLI is missing so a fresh checkout starts without any setup
export const useMock = (engine: Engine) => engine === "mock" || process.env.CREW_MOCK === "1" || (engine === "claude" && !claudeAvailable());
