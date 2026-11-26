import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { db } from "@/lib/db";

// Evals = exam papers for agent roles. A case is: input (what the role receives), plus either
//   expect: deterministic checks done by code (last line, must / must_not regexes), or
//   judge:  a rule checked by a cheap LLM judge (for free-form output, e.g. "names a concrete file").
// Cases live in evals/<role>.json. `npm run eval [-- <role>]` runs them; the retro loop uses them as a gate:
// a learned lesson enters a role prompt only if the pass rate does not drop (CREW_EVAL_GATE=0 disables).

export type EvalCase = {
  id: string;
  input: string;
  expect?: { last_line?: string; must?: string[]; must_not?: string[] };
  judge?: string;
};
export type CaseResult = { id: string; pass: boolean; why: string };
export type EvalRun = { role: string; passed: number; total: number; results: CaseResult[] };

export const EVAL_DIR = process.env.CREW_EVAL_DIR || path.join(process.cwd(), "evals");
export const EVAL_GATE = process.env.CREW_EVAL_GATE !== "0";

export function loadCases(role: string): EvalCase[] {
  const f = path.join(EVAL_DIR, `${role}.json`);
  return fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, "utf8")) as EvalCase[]) : [];
}
export function evalRoles(): string[] {
  return fs.existsSync(EVAL_DIR) ? fs.readdirSync(EVAL_DIR).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)) : [];
}

// Code judge: deterministic yes/no.
export function codeCheck(c: EvalCase, reply: string): CaseResult {
  const e = c.expect ?? {};
  const last = reply.trim().split("\n").filter((l) => l.trim()).at(-1)?.trim() ?? "";
  if (e.last_line && !new RegExp(e.last_line, "i").test(last)) return { id: c.id, pass: false, why: `last line "${last.slice(0, 80)}" !~ /${e.last_line}/` };
  for (const m of e.must ?? []) if (!new RegExp(m, "im").test(reply)) return { id: c.id, pass: false, why: `missing /${m}/` };
  for (const m of e.must_not ?? []) if (new RegExp(m, "im").test(reply)) return { id: c.id, pass: false, why: `forbidden /${m}/` };
  return { id: c.id, pass: true, why: "ok" };
}

function claude(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const cwd = fs.mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "crew-eval-"));
    const p = spawn("claude", args, { cwd, env: { PATH: process.env.PATH, HOME: process.env.HOME } as unknown as NodeJS.ProcessEnv, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    const t = setTimeout(() => p.kill("SIGTERM"), 90_000);
    p.on("close", () => {
      clearTimeout(t); fs.rmSync(cwd, { recursive: true, force: true });
      try { resolve(JSON.parse(out).result ?? ""); } catch { reject(new Error("eval: bad json from claude")); }
    });
    p.on("error", reject);
  });
}

// One retry: a single CLI call occasionally stalls (killed after 90 s).
const claudeRetry = (args: string[]) => claude(args).catch(() => claude(args));

// The role answers with its real prompt but without tools: we test judgement, not tool use.
const answer = (model: string, systemPrompt: string, input: string) =>
  claudeRetry(["-p", "--model", model, "--output-format", "json", "--max-turns", "1", "--tools", "",
    "--setting-sources", "project,local", "--append-system-prompt", systemPrompt, "--", input]);

// LLM judge: pass/fail against one rule.
export async function llmJudge(c: EvalCase, reply: string): Promise<CaseResult> {
  const out = await claudeRetry(["-p", "--model", "haiku", "--output-format", "json", "--max-turns", "1", "--tools", "", "--",
    `You are a strict grader. Rule: ${c.judge}\n\nTask given to the agent:\n${c.input.slice(0, 4000)}\n\nAgent answer:\n${reply.slice(0, 6000)}\n\n` +
    `Does the answer satisfy the rule? Your reply must START with the word PASS or FAIL, then a colon and a short reason.`]);
  const m = out.trim().match(/^\W*(PASS|FAIL)\b:?\s*(.*)/i) ?? out.match(/\b(PASS|FAIL)\b:?\s*(.*)/);
  if (!m) return { id: c.id, pass: false, why: `judge gave no PASS/FAIL: ${out.slice(0, 150)}` };
  return { id: c.id, pass: m[1].toUpperCase() === "PASS", why: (m[2] || "").slice(0, 200) };
}

export async function scoreCase(c: EvalCase, reply: string): Promise<CaseResult> {
  const r = codeCheck(c, reply);
  if (!r.pass || !c.judge) return r;
  return llmJudge(c, reply);
}

export function ensureEvalTable() {
  db().exec(`CREATE TABLE IF NOT EXISTS eval_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT NOT NULL, label TEXT, passed INTEGER NOT NULL, total INTEGER NOT NULL,
    detail TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
}

// Runs all cases of a role. promptOverride = test a candidate prompt without saving it.
export async function runEvals(role: string, opts: { promptOverride?: string; label?: string; repeat?: number } = {}): Promise<EvalRun> {
  const cases = loadCases(role);
  const emp = db().prepare("SELECT model, system_prompt, engine FROM employees WHERE role = ? ORDER BY id LIMIT 1").get(role) as
    { model: string; system_prompt: string; engine: string | null } | undefined;
  if (!emp || !cases.length || emp.engine === "agy") return { role, passed: 0, total: 0, results: [] };
  const prompt = opts.promptOverride ?? emp.system_prompt;
  const results: CaseResult[] = [];
  for (let i = 0; i < (opts.repeat ?? 1); i++) {
    for (const c of cases) {
      try { results.push(await scoreCase(c, await answer(emp.model, prompt, c.input))); }
      catch (e) { results.push({ id: c.id, pass: false, why: (e as Error).message }); }
      if (process.env.CREW_EVAL_VERBOSE) console.error(`  ${role}/${c.id}: ${results.at(-1)!.pass ? "pass" : "FAIL"}`);
    }
  }
  const run = { role, passed: results.filter((r) => r.pass).length, total: results.length, results };
  ensureEvalTable();
  db().prepare("INSERT INTO eval_runs (role, label, passed, total, detail) VALUES (?, ?, ?, ?, ?)")
    .run(role, opts.label ?? "manual", run.passed, run.total, JSON.stringify(results));
  return run;
}

// Gate for prompt changes: keep the candidate only if it is at least as good as the current prompt.
export async function gatePrompt(role: string, candidate: string): Promise<{ ok: boolean; before: number; after: number; total: number }> {
  if (!EVAL_GATE || !loadCases(role).length) return { ok: true, before: 0, after: 0, total: 0 };
  const before = await runEvals(role, { label: "gate:before" });
  if (!before.total) return { ok: true, before: 0, after: 0, total: 0 };
  const after = await runEvals(role, { promptOverride: candidate, label: "gate:after" });
  return { ok: after.passed >= before.passed, before: before.passed, after: after.passed, total: before.total };
}
