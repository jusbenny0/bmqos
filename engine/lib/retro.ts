import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { db } from "@/lib/db";
import { BRAIN_DIR } from "@/lib/brain";
import { CEO_CWD, useMock } from "@/lib/config";

// Self-improving team. Every agent run on a task ends with one RETRO line (what was missing / what it learned).
// A cheap judge (one Haiku call per batch) rates them useful / dup / noise and applies the useful ones:
//   prompt  -> "Lessons" section of that role's system prompt (max 12, oldest drop out)
//   brain   -> brain/team/lessons.md (shared by the whole team)
//   owner   -> brain/team/missing.md (a tool, access or secret the agents cannot fix themselves - work for you)
// Lessons that weaken the process (skip checks, raise limits, push to main) are rejected as noise.
// Disable with CREW_RETRO=0. Overview: GET /api/retro, judge pending now: POST /api/retro.

export const RETRO_ON = process.env.CREW_RETRO !== "0";
export const RETRO_HINT = !RETRO_ON ? "" :
  "\n\nRETRO (required, short): right before the end of your reply (for review roles ABOVE the VERDICT line) write one line " +
  "\"RETRO: missing: <tool, access or information the brief lacked; or -> ; learned: <a general lesson for next time; or ->\". " +
  "Only things useful for future tasks, no summary of the work. If nothing, write \"RETRO: -\".";

const BATCH = Number(process.env.CREW_RETRO_BATCH) || 5;
const MAX_LESSONS = 12;
const MARK = "\n\nLessons (learned automatically from retrospectives):\n";

export function ensureRetroTable() {
  db().exec(`CREATE TABLE IF NOT EXISTS learnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL, task_id INTEGER, kind TEXT NOT NULL, text TEXT NOT NULL,
    verdict TEXT NOT NULL DEFAULT 'pending', target TEXT, rule TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), judged_at TEXT)`);
}

export function parseRetro(reply: string): { gap: string; lesson: string } | null {
  const m = reply.match(/^\s*RETRO:\s*(.+)$/im);
  if (!m) return null;
  const line = m[1].trim();
  const part = (re: RegExp) => line.match(re)?.[1]?.trim().replace(/[;.\s]+$/, "") ?? "";
  return { gap: part(/missing:\s*(.*?)(?:;\s*learned|$)/i), lesson: part(/learned:\s*(.*)$/i) };
}

export function captureRetro(empId: number, taskId: number | undefined, reply: string) {
  if (!RETRO_ON) return;
  const r = parseRetro(reply);
  if (!r) return;
  ensureRetroTable();
  const ins = db().prepare("INSERT INTO learnings (employee_id, task_id, kind, text) VALUES (?, ?, ?, ?)");
  for (const [kind, text] of [["gap", r.gap], ["lesson", r.lesson]] as const)
    if (text && text !== "-" && text.length > 8) ins.run(empId, taskId ?? null, kind, text.slice(0, 400));
  const pending = (db().prepare("SELECT COUNT(*) n FROM learnings WHERE verdict = 'pending'").get() as { n: number }).n;
  if (pending >= BATCH) void judge().catch((e) => console.error("retro judge", e));
}

function haiku(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(CEO_CWD, { recursive: true });
    const p = spawn("claude", ["-p", "--model", process.env.CREW_RETRO_MODEL || "haiku", "--output-format", "json", "--max-turns", "1", "--", prompt],
      { cwd: CEO_CWD, env: { PATH: process.env.PATH, HOME: process.env.HOME } as unknown as NodeJS.ProcessEnv, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    const t = setTimeout(() => p.kill("SIGTERM"), 5 * 60_000);
    p.on("close", () => { clearTimeout(t); try { resolve(JSON.parse(out).result ?? ""); } catch { reject(new Error("retro: bad json")); } });
    p.on("error", reject);
  });
}

function appendBrain(file: string, title: string, line: string) {
  const f = path.join(BRAIN_DIR, "team", file);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  if (!fs.existsSync(f)) fs.writeFileSync(f, `---\ntitle: ${title}\n---\n`);
  fs.appendFileSync(f, `- ${new Date().toISOString().slice(0, 10)} ${line}\n`);
}

// Adds a rule to the role's prompt, keeping only the newest MAX_LESSONS.
export function addLesson(prompt: string, rule: string): string {
  const [head, tail = ""] = prompt.split(MARK);
  const lessons = [...tail.split("\n").filter((l) => l.startsWith("- ") && l !== `- ${rule}`), `- ${rule}`].slice(-MAX_LESSONS);
  return `${head}${MARK}${lessons.join("\n")}`;
}

let running = false;
export async function judge(): Promise<{ judged: number; applied: number }> {
  if (running || useMock("claude")) return { judged: 0, applied: 0 };
  running = true;
  try {
    ensureRetroTable();
    const rows = db().prepare(`SELECT l.id, l.kind, l.text, l.task_id, e.id AS emp, e.name, e.role, e.system_prompt
      FROM learnings l JOIN employees e ON e.id = l.employee_id WHERE l.verdict = 'pending' ORDER BY l.id LIMIT 30`).all() as
      { id: number; kind: string; text: string; task_id: number | null; emp: number; name: string; role: string; system_prompt: string }[];
    if (!rows.length) return { judged: 0, applied: 0 };
    const roles = [...new Map(rows.map((r) => [r.emp, r])).values()]
      .map((r) => `## ${r.name} (${r.role})\n${r.system_prompt.slice(-1500)}`).join("\n\n");
    const lf = path.join(BRAIN_DIR, "team/lessons.md");
    const lessons = fs.existsSync(lf) ? fs.readFileSync(lf, "utf8").slice(-3000) : "";
    const prompt = `You judge retrospectives written by agents of an AI team. For each item decide:
- verdict: "useful" (generally valid, improves future tasks, not already in the prompt/lessons), "dup" (already there), "noise" (one-off, vague, a work summary, or wrong/unsafe - e.g. skipping checks, raising limits, pushing to main).
- target (only for useful): "prompt" (behaviour rule for that role), "brain" (fact/procedure useful for the whole team), "owner" (a missing tool, access, secret or infra the agent cannot fix itself).
- rule (only for useful): one imperative sentence, max 200 characters, concrete.
Return ONLY a JSON array [{"id":1,"verdict":"...","target":"...","rule":"..."}].

Current role prompts:
${roles}

Existing team lessons:
${lessons}

Items:
${rows.map((r) => `{"id":${r.id},"role":"${r.name}","kind":"${r.kind}","task":${r.task_id ?? "null"},"text":${JSON.stringify(r.text)}}`).join("\n")}`;
    const raw = await haiku(prompt);
    const json = raw.match(/\[[\s\S]*\]/)?.[0];
    if (!json) throw new Error("retro: no json array");
    const out = JSON.parse(json) as { id: number; verdict: string; target?: string; rule?: string }[];
    const byId = new Map(rows.map((r) => [r.id, r]));
    const upd = db().prepare("UPDATE learnings SET verdict = ?, target = ?, rule = ?, judged_at = datetime('now') WHERE id = ?");
    let applied = 0;
    for (const o of out) {
      const r = byId.get(o.id);
      if (!r) continue;
      const verdict = ["useful", "dup", "noise"].includes(o.verdict) ? o.verdict : "noise";
      const rule = (o.rule ?? "").replace(/\s+/g, " ").trim().slice(0, 220);
      upd.run(verdict, o.target ?? null, rule || null, o.id);
      if (verdict !== "useful" || !rule) continue;
      applied++;
      if (o.target === "prompt") {
        const cur = (db().prepare("SELECT system_prompt FROM employees WHERE id = ?").get(r.emp) as { system_prompt: string }).system_prompt;
        db().prepare("UPDATE employees SET system_prompt = ? WHERE id = ?").run(addLesson(cur, rule), r.emp);
        appendBrain("lessons.md", "Team lessons (from retrospectives)", `[${r.name}] ${rule}`);
      } else if (o.target === "owner" || o.target === "hermes") {
        appendBrain("missing.md", "What the agents are missing (for the owner)", `[${r.name}, #${r.task_id ?? "-"}] ${rule}`);
      } else {
        appendBrain("lessons.md", "Team lessons (from retrospectives)", `[team] ${rule}`);
      }
    }
    return { judged: out.length, applied };
  } finally {
    running = false;
  }
}
