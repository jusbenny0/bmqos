import fs from "node:fs";
import path from "node:path";

// Playbooks = reusable task recipes (steps, security checklist, stack defaults). Built-in: engine/playbooks/<id>.json.
// User override: data/playbooks/<id>.json (merged over the built-in). data/playbooks/_default.json = {"default": "<id>"}.
export type Step = { role: string; title: string; gate?: string; acceptance: string };
export type Playbook = {
  id: string; title: string; description: string;
  needs: { visual: boolean; qa: boolean; security: boolean };
  steps: Step[]; security_rules: string[]; tech_stack: string[];
  extra_sections?: Record<string, string[]>;
};

const ID = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
export const validId = (s: unknown): s is string => typeof s === "string" && ID.test(s);
export const overrideDir = (): string => process.env.CREW_PLAYBOOKS_DIR || path.join(process.cwd(), "data", "playbooks");
const builtinDir = (): string | undefined =>
  [path.join(process.cwd(), "playbooks"), path.join(process.cwd(), "engine", "playbooks")].find((d) => fs.existsSync(d));

const strs = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");
const read = (file: string): unknown => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return undefined; } };

// Validate an untrusted playbook (file or API). null = invalid.
export function parsePlaybook(v: unknown): Playbook | null {
  const o = v as Playbook;
  if (!o || typeof o !== "object" || !validId(o.id) || typeof o.title !== "string" || typeof o.description !== "string") return null;
  if (!o.needs || typeof o.needs.visual !== "boolean" || typeof o.needs.qa !== "boolean" || typeof o.needs.security !== "boolean") return null;
  if (!Array.isArray(o.steps) || !o.steps.length || !o.steps.every((s) => s && typeof s.role === "string" && typeof s.title === "string" && typeof s.acceptance === "string" && (s.gate === undefined || typeof s.gate === "string"))) return null;
  if (!strs(o.security_rules) || !strs(o.tech_stack)) return null;
  if (o.extra_sections !== undefined && (typeof o.extra_sections !== "object" || o.extra_sections === null || !Object.values(o.extra_sections).every(strs))) return null;
  const { id, title, description, needs, steps, security_rules, tech_stack, extra_sections } = o;
  return { id, title, description, needs: { visual: needs.visual, qa: needs.qa, security: needs.security }, steps: steps.map((s) => ({ role: s.role, title: s.title, ...(s.gate ? { gate: s.gate } : {}), acceptance: s.acceptance })), security_rules, tech_stack, ...(extra_sections ? { extra_sections } : {}) };
}

export function loadPlaybook(id: string): Playbook | null {
  if (!validId(id) || id === "_default") return null;
  const bd = builtinDir();
  const base = bd ? read(path.join(bd, `${id}.json`)) : undefined;
  const over = read(path.join(overrideDir(), `${id}.json`));
  if (over && typeof over === "object") {
    const merged = parsePlaybook({ ...(base as object), ...(over as object), id });
    if (merged) return merged;
  }
  return parsePlaybook(base);
}

export function listPlaybooks(): string[] {
  const ids = new Set<string>();
  for (const d of [builtinDir(), overrideDir()]) {
    try { for (const f of fs.readdirSync(d!)) if (f.endsWith(".json") && validId(f.slice(0, -5)) && f !== "_default.json") ids.add(f.slice(0, -5)); } catch { /* none */ }
  }
  return [...ids].filter((id) => loadPlaybook(id)).sort();
}

export const isOverridden = (id: string): boolean => fs.existsSync(path.join(overrideDir(), `${id}.json`));

export function defaultPlaybook(): string | undefined {
  const d = (read(path.join(overrideDir(), "_default.json")) as { default?: unknown } | undefined)?.default;
  return validId(d) && loadPlaybook(d) ? d : undefined;
}

export function setDefault(id: string | null): void {
  const dir = overrideDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "_default.json"), JSON.stringify({ default: id }) + "\n");
}

// Save a user override: a partial playbook (validated after merging with the built-in). Returns the effective playbook or null.
export function saveOverride(id: string, patch: Record<string, unknown>): Playbook | null {
  if (!validId(id) || id === "_default") return null;
  const dir = overrideDir();
  const prev = read(path.join(dir, `${id}.json`));
  const next = { ...(prev && typeof prev === "object" ? prev : {}), ...patch, id };
  const bd = builtinDir();
  const base = bd ? read(path.join(bd, `${id}.json`)) : undefined;
  if (!parsePlaybook({ ...(base as object), ...next })) return null;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(next, null, 2) + "\n");
  return loadPlaybook(id);
}

export function resetOverride(id: string): boolean {
  if (!validId(id) || id === "_default") return false;
  try { fs.unlinkSync(path.join(overrideDir(), `${id}.json`)); return true; } catch { return false; }
}

// Text the CEO pastes into the task brief.
export function playbookBrief(p: Playbook): string {
  return [
    `Playbook: ${p.title} (${p.id})`,
    "Steps:", ...p.steps.map((s, i) => `${i + 1}. ${s.title} [${s.role}${s.gate ? `, gate: ${s.gate}` : ""}] - ${s.acceptance}`),
    "Security rules:", ...p.security_rules.map((x) => `- ${x}`),
    "Tech stack defaults:", ...p.tech_stack.map((x) => `- ${x}`),
    ...Object.entries(p.extra_sections ?? {}).flatMap(([h, l]) => [`${h}:`, ...l.map((x) => `- ${x}`)]),
  ].join("\n");
}

// One-line catalogue for the CEO prompt.
export function playbookCatalog(): string {
  const ids = listPlaybooks();
  if (!ids.length) return "";
  const def = defaultPlaybook();
  const items = ids.map((id) => `${id}${id === def ? " (default)" : ""}`).join(", ");
  return `Playbooks available: ${items}. Pick the one matching the task type, GET /api/playbooks/<id> (field "brief") and paste its steps, security rules and tech stack into the task brief; set needs_visual/needs_qa/needs_security from its "needs". No fitting playbook = plain brief.`;
}
