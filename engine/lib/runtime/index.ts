import { spawn, execFile } from "node:child_process";
import fs from "node:fs";
import { db, type Employee } from "@/lib/db";
import {
  AGY_CONTEXT_WINDOW, BLOCKED_MODEL, CEO_CWD, COMPACT_AT_BY_ROLE, COMPACT_AT_TOKENS, COMPACT_AT_DEFAULT, CONTEXT_WINDOW, CREW_TOKEN, CREW_URL,
  BASE_BRANCH, MAX_RETURNS, MAX_TURNS_BY_ROLE, MAX_TURNS_DEFAULT, RESET_AT_TOKENS_BY_ROLE, TIMEOUT_MS, personaOf, useMock, withPersona,
} from "@/lib/config";
import { RETRO_HINT, captureRetro } from "@/lib/retro";
import { collectEvidence, stopPreview } from "@/lib/evidence";

export type SendResult = {
  reply: string;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
  costUsd: number;
  sessionId: string;
};

// Limits and paths come from lib/config.ts (env-driven, safe defaults).
// The CEO runs in an empty cwd outside any repo (no code/git/build) and only calls the Crew API via curl.
// NOTE: the CEO runs in a restricted permission mode, so the Claude CLI rejects Bash commands that contain
// unexpanded shell variables ($CREW_URL etc.). The real URL/token must be inlined as literals in its prompt.
function ceoPrompt(): string {
  const team = db().prepare("SELECT name, role FROM employees WHERE role != 'ceo' ORDER BY id").all() as
    { name: string; role: string }[];
  const roster = team.map((e) => `${e.name}(${e.role})`).join(", ") || "no employees";
  const junior = team.find((e) => e.role === "junior")?.name;
  const url = CREW_URL, token = CREW_TOKEN;
  return `You are the CEO - a pure planner. You write no code, run no builds, touch no git - only curl to the Crew API (you have no other tools).
Team: ${roster}. ${junior ? `${junior} (junior, cheapest engine) is the cheapest worker - give HIM simple/mechanical tasks (small fixes, copy, renames, boilerplate, tests); use the builders only for harder work. If ${junior} fails, a builder automatically takes the task over and you see it in events.` : ""}
1) POST /api/tasks {title, brief, needs_qa, needs_visual, needs_security} - the brief must contain: goal; context as node IDs from /api/brain/search (NOT pasted text); acceptance criteria; scope "touch only ..."; role; dependencies; size S/M; repo.
   needs_visual=1 for tasks that change the UI (1440/390 screenshots against the style). needs_qa=1 for UI tasks that should also go through QA.
   needs_security=1 for tasks touching auth/session, secrets/env, payments, public API endpoints, file upload, dependencies or infra/deploy (an automatic no-LLM scan also runs on every task with code).
2) POST /api/delegate {to, taskId, text=brief} - then it runs by itself (builder/junior -> reviewer -> [Security if needs_security/scan] -> [Visual if needs_visual] -> [QA if needs_qa] -> done); step in only on "blocked" (includes escalation from Visual after ${MAX_RETURNS} returned rounds and junior failures).
Reply to the user briefly: plan (tasks + who) + at most 1-3 closed questions.
IMPORTANT: write curl commands with the URL and token written DIRECTLY (no $CREW_URL/$CREW_TOKEN variables - they cannot be expanded in your environment and such a Bash command is rejected). Exactly like this:
curl -s -X POST "${url}/api/tasks" -H "X-Crew-Token: ${token}" -H "Content-Type: application/json" -d '{"title":"...","brief":"...","needs_qa":false,"needs_visual":false,"needs_security":false}'
curl -s -X POST "${url}/api/delegate" -H "X-Crew-Token: ${token}" -H "Content-Type: application/json" -d '{"to":"<employee name>","taskId":1,"text":"..."}'`;
}

type Iter = { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
type Raw = {
  num_turns?: number; result?: string; session_id?: string; is_error?: boolean; total_cost_usd?: number;
  usage?: Iter;
  iterations?: Iter[];
  modelUsage?: Record<string, { contextWindow?: number }>;
};

function runClaude(args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<Raw> {
  return new Promise((resolve, reject) => {
    const p = spawn("claude", args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    const t = setTimeout(() => p.kill("SIGTERM"), TIMEOUT_MS);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => { clearTimeout(t); reject(e); });
    p.on("close", (code) => {
      clearTimeout(t);
      try {
        const j = JSON.parse(out) as Raw;
        if (j.is_error) reject(new Error(j.result || ((j as { subtype?: string }).subtype === "error_max_turns" ? `out of steps (--max-turns ${args[args.indexOf("--max-turns") + 1]})` : `claude error ${(j as { subtype?: string }).subtype ?? ""}`)));
        else resolve(j);
      } catch {
        reject(new Error(`claude exit ${code}: ${(err || out).slice(0, 500)}`));
      }
    });
  });
}

type AgyRaw = {
  conversation_id?: string; status?: string; response?: string; error?: string;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_tokens?: number };
};

function runAgy(args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<AgyRaw> {
  return new Promise((resolve, reject) => {
    const p = spawn("agy", args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    const t = setTimeout(() => p.kill("SIGTERM"), TIMEOUT_MS);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => { clearTimeout(t); reject(e); });
    p.on("close", () => {
      clearTimeout(t);
      try {
        const j = JSON.parse(out) as AgyRaw;
        if (j.status === "ERROR") reject(new Error(j.error || "agy error"));
        else resolve(j);
      } catch {
        reject(new Error(`agy: ${(err || out).slice(0, 500)}`));
      }
    });
  });
}

function usageOf(r: Raw): SendResult["usage"] {
  const u = r.usage ?? {};
  return {
    input: u.input_tokens ?? 0, output: u.output_tokens ?? 0,
    cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0,
  };
}

// Task usage for token_cap: new tokens only (cache reads are excluded, they repeat every turn).
function taskTokens(taskId: number): number {
  const r = db().prepare(
    "SELECT COALESCE(SUM(input_tokens + output_tokens + cache_write_tokens), 0) AS n FROM messages WHERE task_id = ?",
  ).get(taskId) as { n: number };
  return r.n;
}

// true = cap exceeded, task is blocked
function overCap(taskId: number): boolean {
  const t = db().prepare("SELECT token_cap FROM tasks WHERE id = ?").get(taskId) as { token_cap: number | null } | undefined;
  if (!t?.token_cap || taskTokens(taskId) < t.token_cap) return false;
  blockTask(taskId, `token_cap ${t.token_cap} exceeded`);
  return true;
}

function blockTask(taskId: number, text: string) {
  stopPreview(taskId);
  db().prepare("UPDATE tasks SET status = 'blocked', updated_at = datetime('now') WHERE id = ?").run(taskId);
  db().prepare("INSERT INTO events (task_id, kind, text) VALUES (?, 'blocked', ?)").run(taskId, text);
}

function save(empId: number, taskId: number | undefined, role: "user" | "assistant", content: string, u = usageOf({}), cost = 0) {
  db().prepare(
    `INSERT INTO messages (employee_id, task_id, role, content, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(empId, taskId ?? null, role, content, u.input, u.output, u.cacheRead, u.cacheWrite, cost);
}

// Mock engine: canned reply, no CLI needed. Gate roles approve so the whole pipeline can be exercised offline.
function doSendMock(emp: Employee, text: string): SendResult & { ctx: number } {
  const gate = ["reviewer", "qa", "visual", "security"].includes(emp.role);
  const reply = `[mock ${emp.name}] ${text.slice(0, 120)}${gate ? "\n\nVERDICT: APPROVED" : ""}`;
  return { reply, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, costUsd: 0, sessionId: "mock", ctx: 0 };
}

// agy engine (Antigravity CLI): simpler interface, no compaction. Fresh conversation per task
// (sameTask decides whether --conversation is passed).
async function doSendAgy(emp: Employee, text: string, taskId: number | undefined, prompt: string): Promise<SendResult & { ctx: number }> {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME } as unknown as NodeJS.ProcessEnv;
  const cwd = emp.cwd || process.cwd();
  const model = emp.engine_model || "gemini-3.8-flash-medium";
  const sameTask = taskId !== undefined && emp.session_task_id === taskId;
  const convId = sameTask ? emp.session_id : null;
  const args = ["--model", model, "--output-format", "json", "--dangerously-skip-permissions",
    ...(convId ? ["--conversation", convId] : []), "-p", `${prompt ? prompt + "\n\n" : ""}${text}`];
  const r = await runAgy(args, cwd, env);
  const u = r.usage ?? {};
  const usage = { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheRead: u.cache_read_tokens ?? 0, cacheWrite: 0 };
  const sessionId = r.conversation_id ?? (sameTask ? emp.session_id : null) ?? "";
  const ctx = Math.min(100, ((u.input_tokens ?? 0) + (u.cache_read_tokens ?? 0)) / AGY_CONTEXT_WINDOW * 100);
  return { reply: r.response ?? "", usage, costUsd: 0, sessionId, ctx };
}

async function doSend(empId: number, text: string, taskId?: number): Promise<SendResult & { ctx?: number }> {
  const emp = db().prepare("SELECT * FROM employees WHERE id = ?").get(empId) as Employee | undefined;
  if (!emp) throw new Error("employee not found");
  if (new RegExp(BLOCKED_MODEL, "i").test(emp.model)) throw new Error(`model ${emp.model} is blocked (CREW_BLOCKED_MODEL)`);

  if (taskId && overCap(taskId)) throw new Error("token_cap exceeded, task blocked");

  const setEmp = (sql: string, ...a: unknown[]) => db().prepare(`UPDATE employees SET ${sql} WHERE id = ?`).run(...a, empId);
  setEmp("status = 'busy'");
  save(empId, taskId, "user", text);

  const workerHint = taskId
    ? `\n\nRecord the status of task #${taskId} via Bash: curl -s -X PATCH "$CREW_URL/api/tasks/${taskId}" -H "X-Crew-Token: $CREW_TOKEN" -H "Content-Type: application/json" -d '{"pr_url":"...","status":"review"}' (builder after the PR -> review; review roles never change the status, they only write the verdict line - the runtime sets done after the last gate).`
    : "";
  const brainHint = `\n\nBrain (knowledge base): do not read all of it. Search: curl -s "$CREW_URL/api/brain/search?q=<query>" -H "X-Crew-Token: $CREW_TOKEN", then only the node you need: curl -s "$CREW_URL/api/brain/node/<id>" -H "X-Crew-Token: $CREW_TOKEN". Record important decisions: curl -s -X POST "$CREW_URL/api/brain/decision" -H "X-Crew-Token: $CREW_TOKEN" -H "Content-Type: application/json" -d '{"title":"...","text":"what, why, who"}'.`;
  // CEO without a resumed session gets a compact state digest instead of re-reading history (cheap restart).
  const ceoState = (): string => {
    const open = db().prepare("SELECT t.id, t.title, t.status, e.name AS owner FROM tasks t LEFT JOIN employees e ON e.id = t.owner_id WHERE t.status NOT IN ('done','cancelled') ORDER BY t.id DESC LIMIT 25").all() as { id: number; title: string; status: string; owner: string | null }[];
    const team = db().prepare("SELECT id, name, role, engine FROM employees ORDER BY id").all() as { id: number; name: string; role: string; engine: string | null }[];
    return `\n\nCurrent state (from DB):\nTeam: ${team.map((e) => `${e.id} ${e.name} (${e.role}${e.engine ? "/" + e.engine : ""})`).join(", ")}\nOpen tasks: ${open.length ? open.map((t) => `#${t.id} [${t.status}${t.owner ? ", " + t.owner : ""}] ${t.title.slice(0, 80)}`).join("; ") : "none"}`;
  };
  const prompt = emp.role === "ceo" ? `${ceoPrompt()}\n\n${emp.system_prompt}${emp.session_id ? "" : ceoState()}` : withPersona(personaOf(emp.persona), emp.system_prompt) + workerHint + brainHint + (taskId ? RETRO_HINT : "");

  if (useMock(emp.engine)) {
    const r = doSendMock(emp, text);
    save(empId, taskId, "assistant", r.reply, r.usage, 0);
    setEmp("session_id = ?, session_task_id = ?, context_pct = 0, status = 'idle'", r.sessionId, taskId ?? null);
    return r;
  }

  if (emp.engine === "agy") {
    try {
      const r = await doSendAgy(emp, text, taskId, prompt);
      save(empId, taskId, "assistant", r.reply, r.usage, r.costUsd);
      setEmp("session_id = ?, session_task_id = ?, context_pct = ?, status = 'idle'",
        r.sessionId, taskId ?? null, Math.round((r.ctx ?? 0) * 10) / 10);
      if (taskId) overCap(taskId);
      return r;
    } catch (e) {
      // agy junior unavailable/failed -> a builder automatically takes over, no manual step.
      setEmp("status = 'idle'");
      if (taskId) {
        const fallback = findRole("builder");
        const msg = `agy (${emp.name}) failed: ${(e as Error).message}`;
        ev(taskId, "error", msg);
        if (fallback) {
          ev(taskId, "fallback", `${emp.name} → ${fallback.name} (agy unavailable/failed)`);
          db().prepare("UPDATE tasks SET owner_id = ?, updated_at = datetime('now') WHERE id = ?").run(fallback.id, taskId);
          return send(fallback.id, `(Taken over from ${emp.name}, agy failed: ${(e as Error).message})\n\n${text}`, taskId);
        }
        blockTask(taskId, `${msg}, no builder available for fallback`);
      }
      save(empId, taskId, "assistant", `[error] ${(e as Error).message}`);
      throw e;
    }
  }

  const env = {
    PATH: process.env.PATH, HOME: process.env.HOME,
    // Claude Code's own auto-compact inside one run fires at the same size as the runtime compaction.
    CLAUDE_CODE_AUTO_COMPACT_WINDOW: String(COMPACT_AT_TOKENS),
    CREW_URL, CREW_TOKEN,
  } as unknown as NodeJS.ProcessEnv;
  // The CEO gets an empty cwd outside any repo (no code/git/CLAUDE.md), specialists get their own worktree.
  const cwd = emp.role === "ceo" ? CEO_CWD : (emp.cwd || process.cwd());
  if (emp.role === "ceo") fs.mkdirSync(CEO_CWD, { recursive: true });
  const maxTurns = String(MAX_TURNS_BY_ROLE[emp.role] ?? MAX_TURNS_DEFAULT);
  // CEO = pure planner: curl to the Crew API only, no other tool, no interactive approval
  // (a non-interactive session would reject it anyway) and no user ~/.claude/settings.json hooks.
  const base = emp.role === "ceo"
    ? ["-p", "--model", emp.model, "--output-format", "json", "--max-turns", maxTurns,
       "--permission-mode", "default", "--permission-prompts", "none",
       "--allowedTools", "Bash(curl:*)", "--setting-sources", "project,local"]
    : ["-p", "--model", emp.model, "--output-format", "json", "--max-turns", maxTurns,
       "--permission-mode", process.env.CREW_PERMISSION_MODE || "bypassPermissions"];

  // Fresh session per NEW task: specialists may --resume only within the same task (session_task_id).
  // The CEO has a long-lived session across tasks (reset only explicitly, /api/ceo/chat {newSession:true}).
  const sameTask = emp.role === "ceo" || (taskId !== undefined && emp.session_task_id === taskId);
  const resumeId = sameTask ? emp.session_id : null;

  try {
    const args = [...base, ...(resumeId ? ["--resume", resumeId] : []),
      ...(prompt ? ["--append-system-prompt", prompt] : []), "--", text];
    const r = await runClaude(args, cwd, env);
    const usage = usageOf(r);
    const costUsd = r.total_cost_usd ?? 0;
    let sessionId = r.session_id ?? (sameTask ? emp.session_id : null) ?? "";
    // Context = size of the LAST turn (not the sum over the run): the last iteration reflects what is in the window now (input + cache).
    const window = Object.values(r.modelUsage ?? {})[0]?.contextWindow || CONTEXT_WINDOW;
    const last = r.iterations?.at(-1) ?? r.usage ?? {};
    const lastCtx = (last.input_tokens ?? 0) + (last.cache_read_input_tokens ?? 0) + (last.cache_creation_input_tokens ?? 0);
    const pct = Math.min(100, (lastCtx / window) * 100);
    save(empId, taskId, "assistant", r.result ?? "", usage, costUsd);

    // Compact at an absolute size (default 500k tokens), never above the role's % of the model window.
    const compactAtTokens = Math.min(COMPACT_AT_TOKENS, window * (COMPACT_AT_BY_ROLE[emp.role] ?? COMPACT_AT_DEFAULT) / 100);
    let ctx = pct;
    // Cost guard: a long session re-reads its whole context on every reply (CEO reached ~$4-5 per answer).
    // Roles in RESET_AT_TOKENS_BY_ROLE start a fresh session once the context passes the limit; their state lives in the DB/brain.
    const resetAt = RESET_AT_TOKENS_BY_ROLE[emp.role];
    if (resetAt && lastCtx >= resetAt) {
      sessionId = "";
      ctx = 0;
      if (taskId) ev(taskId, "status", `${emp.name}: new session (context ${Math.round(lastCtx / 1000)}k tokens, cost saving)`);
    } else if (lastCtx >= compactAtTokens && sessionId) {
      try {
        const c = await runClaude([...base, "--resume", sessionId, "/compact"], cwd, env);
        sessionId = c.session_id ?? sessionId;
        save(empId, taskId, "assistant", "[/compact]", usageOf(c), c.total_cost_usd ?? 0);
        ctx = emp.context_pct; // unknown after compaction, keep the previous value; recomputed on the next message
      } catch (e) {
        if (taskId) db().prepare("INSERT INTO events (task_id, kind, text) VALUES (?, 'error', ?)").run(taskId, `compact: ${(e as Error).message}`);
      }
    }
    setEmp("session_id = ?, session_task_id = ?, context_pct = ?, status = 'idle'",
      sessionId, taskId ?? null, Math.round(ctx * 10) / 10);

    if (taskId) overCap(taskId);
    return { reply: r.result ?? "", usage, costUsd, sessionId };
  } catch (e) {
    setEmp("status = 'error'");
    save(empId, taskId, "assistant", `[error] ${(e as Error).message}`);
    throw e;
  }
}

// One queue per employee: messages of the same employee run sequentially.
const g = globalThis as unknown as { __crewQ?: Map<number, Promise<unknown>> };
const queues = (g.__crewQ ??= new Map());

function ghDiff(pr: string): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile("gh", ["pr", "diff", "--", pr], { maxBuffer: 20_000_000, timeout: 60_000 }, (e, out) =>
      e ? reject(new Error(`gh pr diff: ${e.message.slice(0, 300)}`)) : resolve(out.slice(0, 30_000)),
    ),
  );
}

// Cheap automatic scan WITHOUT an LLM, runs in the builder's cwd (the worktree already has the changes on its branch)
// right after the run, BEFORE the handoff to the reviewer: regex for secrets in the diff + npm audit when package
// files changed. Never breaks the pipeline - a scan error is ignored.
const SECRET_PATTERNS = [
  /-----BEGIN (RSA|EC|OPENSSH|PGP|DSA) PRIVATE KEY-----/,
  /AKIA[0-9A-Z]{16}/, // AWS access key id
  /(?:api[_-]?key|secret|token|password|passwd)\s*[=:]\s*["'][A-Za-z0-9_\-/+=]{16,}["']/i,
  /ghp_[A-Za-z0-9]{36}/, // GitHub PAT
  /sk-[A-Za-z0-9]{32,}/, // OpenAI/Anthropic-style secret key
];

function execCwd(cmd: string, args: string[], cwd: string, timeout = 30_000): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile(cmd, args, { cwd, maxBuffer: 10_000_000, timeout }, (e, out) => (e ? reject(e) : resolve(out))),
  );
}

async function scanWorktree(cwd: string): Promise<string[]> {
  const findings: string[] = [];
  try {
    const diff = await execCwd("git", ["diff", `origin/${BASE_BRANCH}...HEAD`, "--"], cwd);
    for (const line of diff.split("\n")) {
      if (!line.startsWith("+") || line.startsWith("+++")) continue;
      for (const re of SECRET_PATTERNS) {
        if (re.test(line)) { findings.push(`possible secret in diff: ${line.trim().slice(0, 160)}`); break; }
      }
    }
    if (/^diff --git a\/package(-lock)?\.json/m.test(diff)) {
      try {
        const audit = await execCwd("npm", ["audit", "--omit=dev", "--audit-level=high", "--json"], cwd, 60_000);
        const a = JSON.parse(audit) as { metadata?: { vulnerabilities?: Record<string, number> } };
        const v = a.metadata?.vulnerabilities ?? {};
        const bad = (v.high ?? 0) + (v.critical ?? 0);
        if (bad > 0) findings.push(`npm audit: ${bad} high/critical vulnerability(ies) in dependencies`);
      } catch (e) {
        // npm audit exits non-zero on findings too (not only on errors) -> try to parse JSON from the error
        const out = (e as { stdout?: string }).stdout;
        if (out) {
          try {
            const a = JSON.parse(out) as { metadata?: { vulnerabilities?: Record<string, number> } };
            const v = a.metadata?.vulnerabilities ?? {};
            const bad = (v.high ?? 0) + (v.critical ?? 0);
            if (bad > 0) findings.push(`npm audit: ${bad} high/critical vulnerability(ies) in dependencies`);
          } catch { /* scan is best-effort, ignore */ }
        }
      }
    }
  } catch { /* scan is best-effort: errors (git/npm missing, branch without origin) are ignored */ }
  return findings;
}

// Mandatory automatic gate BEFORE the handoff to the reviewer (no LLM): the agent must prove its work instead of
// just writing "Compiled successfully". Checks that the worktree has no uncommitted changes and that types and build
// really pass, and writes SHA + branch into the handoff so the gate roles review exactly this commit.
async function verifyWorktree(cwd: string): Promise<{ ok: boolean; report: string; buildLog: string }> {
  const lines: string[] = [];
  let ok = true;
  let buildLog = "";
  const run = async (label: string, cmd: string, args: string[], timeout: number) => {
    try {
      const out = await execCwd(cmd, args, cwd, timeout);
      if (label.startsWith("build")) buildLog = out;
      lines.push(`${label}: OK`);
    } catch (e) {
      ok = false;
      const x = e as { stdout?: string; stderr?: string; message?: string };
      const out = `${x.stdout ?? ""}\n${x.stderr ?? ""}`.trim() || x.message || "";
      lines.push(`${label}: FAILED\n${out.split("\n").slice(-25).join("\n").slice(0, 2500)}`);
    }
  };
  try {
    const sha = (await execCwd("git", ["rev-parse", "--short", "HEAD"], cwd)).trim();
    const branch = (await execCwd("git", ["rev-parse", "--abbrev-ref", "HEAD"], cwd)).trim();
    lines.push(`HEAD ${sha} on branch ${branch}`);
    const dirty = (await execCwd("git", ["status", "--porcelain", "--untracked-files=no"], cwd)).trim();
    if (dirty) { ok = false; lines.push(`Uncommitted changes (commit them):\n${dirty.split("\n").slice(0, 15).join("\n")}`); }
  } catch { lines.push("git unavailable, gate skipped"); return { ok: true, report: lines.join("\n"), buildLog }; }
  try {
    const pkg = JSON.parse((await execCwd("cat", ["package.json"], cwd)) || "{}") as { scripts?: Record<string, string> };
    if (pkg.scripts?.build) {
      await run("types (tsc --noEmit)", "node_modules/.bin/tsc", ["--noEmit"], 180_000);
      await run("build (npm run build)", "npm", ["run", "build"], 280_000);
    } else lines.push("package.json has no build script, gate skipped");
  } catch { lines.push("no package.json, gate skipped"); }
  return { ok, report: `Automatic gate:\n${lines.join("\n")}`, buildLog };
}

type T = { id: number; title: string; brief: string; status: string; owner_id: number | null; reviewer_id: number | null; pr_url: string | null; handoff_note: string; needs_qa: number; needs_visual: number; needs_security: number };
const ev = (taskId: number, kind: string, text: string) => db().prepare("INSERT INTO events (task_id, kind, text) VALUES (?, ?, ?)").run(taskId, kind, text);
const getTask = (id: number) => db().prepare("SELECT * FROM tasks WHERE id = ?").get(id) as T;
const findRole = (role: string) => db().prepare("SELECT * FROM employees WHERE role = ? ORDER BY id LIMIT 1").get(role) as Employee | undefined;

function reviewPrompt(byWhom: string, t: T, note: string, diff: string): string {
  return `${byWhom} task #${t.id}: ${t.title}\n\nBrief:\n${t.brief}\n\nHandoff:\n${note}\n` +
    (diff ? `\nDiff (${t.pr_url}):\n${diff}\n` : "") +
    `\nReview rules: if the brief says "do not push" / "commit locally", a missing PR or pr_url is NOT a reason to return (merging is done by a human). Do not return for things that cannot be verified without secrets or a database - mark them "unverified" and judge the rest. Return only for a concrete defect in code/appearance against the brief.\n` +
    `\nEnd the reply with a last line that is exactly "VERDICT: APPROVED" or "VERDICT: RETURN" (with the reason above it).`;
}

// Sends the task to the next gate by role (reviewer_id is overwritten because GET /api/employees
// uses it as "who is reviewing now").
async function handTo(role: string, label: string, t: T, note: string): Promise<boolean> {
  const next = findRole(role);
  if (!next) { blockTask(t.id, `Handoff: no ${label} (role ${role})`); return false; }
  const diff = t.pr_url ? await ghDiff(t.pr_url) : "";
  db().prepare("UPDATE tasks SET status = 'review', reviewer_id = ?, updated_at = datetime('now') WHERE id = ?").run(next.id, t.id);
  ev(t.id, "handoff", `→ ${next.name} (${label})`);
  await send(next.id, reviewPrompt(`Review (${label})`, t, note, diff), t.id);
  return true;
}

// Gate order after the Reviewer: Security (needs_security) -> Visual (needs_visual) -> QA (needs_qa) -> done.
// After any gate approves, move to the first NEXT stage that is needed - regardless of which role approved.
const STAGE_ORDER: { role: string; label: string; flag: "needs_security" | "needs_visual" | "needs_qa" }[] = [
  { role: "security", label: "Security", flag: "needs_security" },
  { role: "visual", label: "Visual", flag: "needs_visual" },
  { role: "qa", label: "QA", flag: "needs_qa" },
];

async function advanceAfterApproval(emp: Employee, t: T, reply: string): Promise<void> {
  const idx = emp.role === "reviewer" ? -1 : STAGE_ORDER.findIndex((s) => s.role === emp.role);
  for (let i = idx + 1; i < STAGE_ORDER.length; i++) {
    const stage = STAGE_ORDER[i];
    if (t[stage.flag]) {
      if (await handTo(stage.role, stage.label, t, t.handoff_note || reply)) return;
      return;
    }
  }
  db().prepare("UPDATE tasks SET status = 'done', updated_at = datetime('now') WHERE id = ?").run(t.id);
  stopPreview(t.id);
}

// Autonomous handoff: builder/junior done -> automatic scan -> Reviewer -> [Security if needs_security/scan] ->
// [Visual if needs_visual] -> [QA if needs_qa] -> done. Visual has its own return limit, then escalates to the CEO.
async function afterRun(emp: Employee, taskId: number, reply: string) {
  const t = getTask(taskId);
  if (t.status === "done" || t.status === "blocked") return;
  if (emp.role === "builder" || emp.role === "junior" || emp.role === "designer") {
    // A builder may set the status to "review" itself (see workerHint), so the CURRENT task status cannot tell
    // whether this run should start the handoff or is just a follow-up chat message on an already handed-off task.
    // Decide from the history: if no handoff happened since the last assignment (delegated/returned*), start it.
    const since = db().prepare("SELECT kind FROM events WHERE task_id = ? ORDER BY id DESC LIMIT 20").all(taskId) as { kind: string }[];
    for (const { kind } of since) {
      if (kind === "handoff") return; // this assignment cycle was already handed to review, further messages are just chat
      if (kind === "delegated" || kind === "returned" || kind === "returned_visual") break; // handoff has not run yet -> continue
    }
    if (!t.pr_url && !t.handoff_note) return blockTask(taskId, "Builder finished without pr_url and handoff_note, handoff impossible");
    if (emp.cwd) {
      const findings = await scanWorktree(emp.cwd);
      if (findings.length) {
        db().prepare("UPDATE tasks SET needs_security = 1, updated_at = datetime('now') WHERE id = ?").run(taskId);
        ev(taskId, "scan", findings.join(" | ").slice(0, 2000));
      }
    }
    let note = t.handoff_note || reply;
    if (emp.cwd) {
      const gate = await verifyWorktree(emp.cwd);
      ev(taskId, "gate", gate.report.slice(0, 2000));
      if (!gate.ok) {
        const returns = (db().prepare("SELECT COUNT(*) AS n FROM events WHERE task_id = ? AND kind = 'returned'").get(taskId) as { n: number }).n;
        if (returns >= MAX_RETURNS) return blockTask(taskId, `Automatic gate failed (${returns + 1}x), waiting for a human`);
        db().prepare("UPDATE tasks SET status = 'doing', updated_at = datetime('now') WHERE id = ?").run(taskId);
        ev(taskId, "returned", `Automatic gate: returned to the builder`);
        return void (await send(emp.id, `The automatic gate before the handoff of task #${taskId} failed. Fix it, commit and finish (the handoff reruns automatically).\n\n${gate.report}`, taskId));
      }
      note = `${note}\n\n${gate.report}`;
      const evd = await collectEvidence(taskId, emp.cwd, BASE_BRANCH, gate.buildLog);
      if (evd) { ev(taskId, "evidence", evd.slice(0, 2000)); note = `${note}\n\n${evd}`; }
    }
    await handTo("reviewer", "Reviewer", t, note);
  } else if (emp.role === "reviewer" || emp.role === "qa" || emp.role === "visual" || emp.role === "security") {
    if (t.status !== "review") return;
    const ok = /VERDICT:\s*APPROVED/i.test(reply.slice(-200));
    const back = /VERDICT:\s*RETURN/i.test(reply.slice(-200));
    const label = emp.role === "qa" ? "QA" : emp.role === "visual" ? "Visual" : emp.role === "security" ? "Security" : "Reviewer";
    if (!ok && !back) return blockTask(taskId, `${label} gave no verdict (VERDICT: APPROVED / RETURN)`);
    if (!ok) {
      if (emp.role === "visual") {
        // Visual: at most MAX_RETURNS returned rounds, then escalate straight to the CEO (not just "waiting for a human").
        const vreturns = (db().prepare("SELECT COUNT(*) AS n FROM events WHERE task_id = ? AND kind = 'returned_visual'").get(taskId) as { n: number }).n;
        if (vreturns >= MAX_RETURNS || !t.owner_id) return blockTask(taskId, `Visual returned the task (${vreturns + 1}x) - escalating to the CEO`);
        db().prepare("UPDATE tasks SET status = 'doing', updated_at = datetime('now') WHERE id = ?").run(taskId);
        ev(taskId, "returned_visual", `${emp.name}: returned to the builder (visual findings)`);
        return void (await send(t.owner_id, `Visual returned task #${taskId} (concrete findings below: element/problem/fix). Fix, update the PR/handoff_note and finish.\n\n${reply}`, taskId));
      }
      const returns = (db().prepare("SELECT COUNT(*) AS n FROM events WHERE task_id = ? AND kind = 'returned'").get(taskId) as { n: number }).n;
      if (returns >= MAX_RETURNS || !t.owner_id) return blockTask(taskId, `${label} returned the work (${returns + 1}x), waiting for a human`);
      db().prepare("UPDATE tasks SET status = 'doing', updated_at = datetime('now') WHERE id = ?").run(taskId);
      ev(taskId, "returned", `${emp.name}: returned to the builder`);
      return void (await send(t.owner_id, `${label} returned task #${taskId}. Fix it according to the comments, update the PR/handoff_note and finish.\n\n${reply}`, taskId));
    }
    ev(taskId, "verdict", `${emp.name}: approved`);
    await advanceAfterApproval(emp, t, reply);
  }
}

export function send(employeeId: number, text: string, taskId?: number): Promise<SendResult> {
  const prev = queues.get(employeeId) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(() => doSend(employeeId, text, taskId));
  queues.set(employeeId, run);
  run.catch(() => undefined).finally(() => { if (queues.get(employeeId) === run) queues.delete(employeeId); });
  if (taskId) {
    // The chain runs in the background; a handoff error = event + blocked, never silent.
    const fail = (e: unknown) => { const m = e instanceof Error ? e.message : "run failed"; ev(taskId, "error", m); blockTask(taskId, `Run/handoff failed: ${m}`); };
    run.then(async (r: SendResult) => {
      const emp = db().prepare("SELECT * FROM employees WHERE id = ?").get(employeeId) as Employee;
      try { captureRetro(emp.id, taskId, r.reply); } catch (e) { console.error("retro", e); }
      await afterRun(emp, taskId, r.reply);
    }).catch(fail);
  }
  return run;
}
