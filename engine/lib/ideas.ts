import fs from "node:fs";
import { spawn } from "node:child_process";
import { db } from "@/lib/db";
import { ADVISORS_DIR, askAdvisor, validSlug } from "@/lib/advisors";
import { TIMEOUT_MS, TOKEN_CAP_BY_SIZE, claudeAvailable } from "@/lib/config";

// Idea discussion: Designer, Builder, Security (+ Advisor if one exists) give one short opinion each (Haiku),
// then the CEO synthesises (Sonnet): summary, max 3 open questions with a recommended answer, proposed tasks.
// Total spend is capped (IDEA_TOKEN_CAP); once reached, remaining roles are skipped and the synthesis is built without an LLM.
export const IDEA_TOKEN_CAP = Number(process.env.CREW_IDEA_CAP) || 60_000;
export const MAX_QUESTIONS = 3;
export const MAX_TASKS = 8;
const OPINION_MAX = 1500;

export type Ask = (role: string, model: "haiku" | "sonnet", prompt: string) => Promise<{ text: string; tokens: number }>;
export type Opinion = { role: string; text: string };
export type Synthesis = {
  summary: string;
  questions: { q: string; recommended: string }[];
  tasks: { title: string; brief: string; size: "S" | "M" | "L"; tokens: number }[];
};
export type Idea = {
  id: number; text: string; status: "discussing" | "ready" | "approved" | "failed";
  opinions: Opinion[]; synthesis: Synthesis | null; tokens: number; task_ids: number[]; created_at: string;
};

const ROLES: [string, string][] = [
  ["Designer", "UX, scope of the user-facing parts, what would feel wrong to the user."],
  ["Builder", "Feasibility, simplest implementation, effort, dependencies."],
  ["Security", "Risks: auth, data, secrets, abuse, dependencies."],
];

type Row = { id: number; text: string; status: Idea["status"]; opinions: string; synthesis: string | null; tokens: number; task_ids: string; created_at: string };
const toIdea = (r: Row): Idea => ({ ...r, opinions: JSON.parse(r.opinions), synthesis: r.synthesis ? JSON.parse(r.synthesis) : null, task_ids: JSON.parse(r.task_ids) });

export function getIdea(id: number): Idea | undefined {
  const r = db().prepare("SELECT * FROM ideas WHERE id = ?").get(id) as Row | undefined;
  return r && toIdea(r);
}
export const listIdeas = (): Idea[] => (db().prepare("SELECT * FROM ideas ORDER BY id DESC").all() as Row[]).map(toIdea);
export const createIdea = (text: string): Idea => getIdea(Number(db().prepare("INSERT INTO ideas (text) VALUES (?)").run(text).lastInsertRowid))!;

// First advisor with a kb/ folder, if any.
export function firstAdvisor(root = ADVISORS_DIR): string | null {
  try {
    return fs.readdirSync(root).sort().find((s) => validSlug(s) && fs.existsSync(`${root}/${s}/kb`)) ?? null;
  } catch { return null; }
}

function claudeAsk(): Ask {
  return (_role, model, prompt) => new Promise((resolve, reject) => {
    const args = ["-p", "--model", model, "--output-format", "json", "--max-turns", "1",
      "--disallowedTools", "Bash,Edit,Write,Read,Glob,Grep,WebFetch,WebSearch", "--setting-sources", "project,local", "--", prompt];
    const p = spawn("claude", args, { cwd: process.env.TMPDIR || "/tmp", env: { PATH: process.env.PATH, HOME: process.env.HOME } as unknown as NodeJS.ProcessEnv, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const t = setTimeout(() => p.kill("SIGTERM"), Math.min(TIMEOUT_MS, 5 * 60_000));
    p.stdout.on("data", (d) => (out += d));
    p.on("error", (e) => { clearTimeout(t); reject(e); });
    p.on("close", () => {
      clearTimeout(t);
      try {
        const j = JSON.parse(out) as { result?: string; is_error?: boolean; usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number } };
        if (j.is_error) return reject(new Error(j.result || "claude error"));
        const u = j.usage ?? {};
        resolve({ text: j.result ?? "", tokens: (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) });
      } catch { reject(new Error("claude failed")); }
    });
  });
}

const mockAsk: Ask = async (role, model, prompt) => {
  if (model === "sonnet") {
    const synth: Synthesis = {
      summary: "[mock] Idea discussed by the team.",
      questions: [{ q: "Who is the first user?", recommended: "The owner of the instance." }],
      tasks: [{ title: "[mock] Build the first slice", brief: "Smallest useful version.", size: "S", tokens: TOKEN_CAP_BY_SIZE.S }],
    };
    return { text: JSON.stringify(synth), tokens: 100 };
  }
  return { text: `[mock ${role}] ${prompt.slice(0, 60)}`, tokens: 50 };
};

// Default asker: real Claude, or the mock only when CREW_MOCK=1 (explicit dry run). A missing `claude` CLI is an error, never fake output.
export const defaultAsk = (): Ask => {
  if (process.env.CREW_MOCK === "1") return mockAsk;
  if (!claudeAvailable()) return async () => { throw new Error("claude CLI is not available"); };
  const claude = claudeAsk();
  return async (role, model, prompt) => {
    if (!role.startsWith("Advisor:")) return claude(role, model, prompt);
    const text = await askAdvisor(role.slice(8), prompt, model);
    return { text, tokens: Math.ceil((prompt.length + text.length) / 4) };
  };
};

const brief = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, OPINION_MAX);

export function parseSynthesis(raw: string, fallbackSummary: string): Synthesis {
  const clean = (s: unknown, n: number) => (typeof s === "string" ? s.trim().slice(0, n) : "");
  let j: Partial<Synthesis> = {};
  try { j = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)); } catch { /* fall back to plain text */ }
  const sizes = ["S", "M", "L"];
  return {
    summary: clean(j.summary, 2000) || clean(raw, 2000) || fallbackSummary,
    questions: (Array.isArray(j.questions) ? j.questions : []).slice(0, MAX_QUESTIONS)
      .map((x) => ({ q: clean(x?.q, 300), recommended: clean(x?.recommended, 300) })).filter((x) => x.q),
    tasks: (Array.isArray(j.tasks) ? j.tasks : []).slice(0, MAX_TASKS).map((t) => {
      const size = sizes.includes(t?.size as string) ? (t.size as "S" | "M" | "L") : "M";
      const tokens = Number.isFinite(t?.tokens) && t.tokens > 0 ? Math.round(t.tokens) : TOKEN_CAP_BY_SIZE[size] ?? TOKEN_CAP_BY_SIZE.M;
      return { title: clean(t?.title, 200), brief: clean(t?.brief, 2000), size, tokens };
    }).filter((t) => t.title),
  };
}

export async function runDiscussion(id: number, ask: Ask = defaultAsk()): Promise<Idea> {
  const idea = getIdea(id)!;
  const roles = [...ROLES];
  const adv = firstAdvisor();
  if (adv) roles.push([`Advisor:${adv}`, "Advice from the owner's own materials only (kb/); say so if they do not cover it."]);
  const opinions: Opinion[] = [];
  let tokens = 0;
  try {
    for (const [role, focus] of roles) {
      if (tokens >= IDEA_TOKEN_CAP) break;
      const prompt = `Raw idea from the owner:\n"""${idea.text}"""\n\nYou are the ${role.replace(/^Advisor:/, "advisor ")} in a short team discussion. Focus: ${focus}\n` +
        "Give ONE round: your opinion and the main risks, max 120 words, no preamble.";
      try {
        const r = await ask(role, "haiku", prompt);
        tokens += r.tokens;
        opinions.push({ role: role.replace(/^Advisor:/, "Advisor "), text: brief(r.text) });
      } catch (e) {
        opinions.push({ role, text: `(unavailable: ${e instanceof Error ? e.message : "error"})` });
      }
    }
    const digest = opinions.map((o) => `${o.role}: ${o.text}`).join("\n");
    let synthesis: Synthesis;
    if (tokens >= IDEA_TOKEN_CAP) {
      synthesis = { summary: `Token cap (${IDEA_TOKEN_CAP}) reached before synthesis.\n${digest}`.slice(0, 2000), questions: [], tasks: [] };
    } else {
      const prompt = `You are the CEO moderating a short discussion about this idea:\n"""${idea.text}"""\n\nOpinions:\n${digest}\n\n` +
        `Reply with JSON only: {"summary": string, "questions": [{"q": string, "recommended": string}] (max ${MAX_QUESTIONS}, only what the owner must decide, each with your recommended answer), ` +
        `"tasks": [{"title": string, "brief": string, "size": "S"|"M"|"L", "tokens": number (estimated new tokens)}] (max ${MAX_TASKS}, smallest useful slices)}.`;
      const r = await ask("CEO", "sonnet", prompt);
      tokens += r.tokens;
      synthesis = parseSynthesis(r.text, digest);
    }
    db().prepare("UPDATE ideas SET status='ready', opinions=?, synthesis=?, tokens=? WHERE id=?").run(JSON.stringify(opinions), JSON.stringify(synthesis), tokens, id);
  } catch {
    db().prepare("UPDATE ideas SET status='failed', opinions=?, tokens=? WHERE id=?").run(JSON.stringify(opinions), tokens, id);
  }
  return getIdea(id)!;
}

// One-click approval: creates the proposed tasks (status todo). `answers` override the recommended answers (by question index).
export function approveIdea(id: number, answers: string[] = []): Idea | { error: string } {
  const idea = getIdea(id);
  if (!idea) return { error: "not found" };
  if (idea.status !== "ready" || !idea.synthesis) return { error: "idea is not ready" };
  const decisions = idea.synthesis.questions.map((q, i) => `- ${q.q} → ${answers[i]?.trim() || q.recommended}`).join("\n");
  const ins = db().prepare("INSERT INTO tasks (title, brief, token_cap) VALUES (?, ?, ?)");
  const ev = db().prepare("INSERT INTO events (task_id, kind, text) VALUES (?, 'created', ?)");
  const ids = db().transaction(() => idea.synthesis!.tasks.map((t) => {
    const body = `${t.brief}\n\nSize: ${t.size}\nFrom idea #${id}: ${idea.text.slice(0, 500)}${decisions ? `\n\nDecisions:\n${decisions}` : ""}`;
    const tid = Number(ins.run(t.title, body, TOKEN_CAP_BY_SIZE[t.size] ?? TOKEN_CAP_BY_SIZE.M).lastInsertRowid);
    ev.run(tid, `${t.title} (idea #${id})`);
    return tid;
  }))();
  db().prepare("UPDATE ideas SET status='approved', task_ids=? WHERE id=?").run(JSON.stringify(ids), id);
  return getIdea(id)!;
}
