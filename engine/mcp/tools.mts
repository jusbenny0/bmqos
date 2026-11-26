// Shared tool set of the Crew MCP server. Env: CREW_URL (default http://localhost:3800), CREW_API_TOKEN.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const base = (process.env.CREW_URL ?? "http://localhost:3800").replace(/\/$/, "");
const token = process.env.CREW_API_TOKEN ?? "";

async function api(method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(base + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

const cap = (s: string) => (s.length > 6000 ? s.slice(0, 6000) + `…[truncated ${s.length - 6000} chars]` : s);
type Task = { id: number; title: string; status: string; owner_id: number | null; pr_url: string | null; handoff_note?: string };
const brief = (t: Task) => ({ id: t.id, title: t.title, status: t.status, owner_id: t.owner_id, pr_url: t.pr_url });
const out = async (p: Promise<unknown>) => {
  try {
    return { content: [{ type: "text" as const, text: cap(JSON.stringify(await p)) }] };
  } catch (e) {
    return { isError: true, content: [{ type: "text" as const, text: String(e instanceof Error ? e.message : e) }] };
  }
};

export function createServer(): McpServer {
const server = new McpServer({ name: "crew-engine", version: "1.1.0" });

server.registerTool("give_task", {
  description: "Create a task in Crew (status todo).",
  inputSchema: { title: z.string(), brief: z.string(), owner_id: z.number().int().optional(), token_cap: z.number().int().optional() },
}, (a) => out(api("POST", "/api/tasks", a)));

server.registerTool("list_tasks", {
  description: "List tasks (newest first), optionally filtered by status.",
  inputSchema: { status: z.enum(["todo", "doing", "review", "done", "blocked"]).optional() },
}, ({ status }) => out(api("GET", "/api/tasks").then((t) => (t as Task[]).filter((x) => !status || x.status === status).slice(0, 30).map(brief))));

server.registerTool("task_status", {
  description: "Task detail: status, history, PR, tokens.",
  inputSchema: { id: z.number().int() },
}, ({ id }) => out(api("GET", `/api/tasks/${id}`)));

server.registerTool("approve", {
  description: "Approve a task (status -> done).",
  inputSchema: { id: z.number().int() },
}, ({ id }) => out(api("PATCH", `/api/tasks/${id}`, { status: "done" })));

server.registerTool("answer", {
  description: "Reply / send a message to an agent (employee_id); without it, to the CEO. Optionally tied to a task.",
  inputSchema: { text: z.string(), employee_id: z.number().int().optional(), task_id: z.number().int().optional() },
}, ({ text, employee_id, task_id }) =>
  out(employee_id === undefined ? api("POST", "/api/chat", { text }) : api("POST", `/api/team/${employee_id}/message`, { text, taskId: task_id })));

server.registerTool("team_status", {
  description: "Team: who works on what, last step, tokens today.",
}, () => out(api("GET", "/api/team")));

server.registerTool("list_providers", {
  description: "Detected AI services on the engine host (CLI subscriptions, API keys by presence only, local models).",
}, () => out(api("GET", "/api/providers")));

server.registerTool("spend_summary", {
  description: "Token and cost usage per agent and task.",
  inputSchema: { range: z.enum(["24h", "7d"]).optional() },
}, ({ range }) => out(api("GET", `/api/usage?range=${range ?? "24h"}`)));


server.registerTool("return_task", {
  description: "Return a task to its owner with feedback (status -> doing, message sent to the owner).",
  inputSchema: { id: z.number().int(), feedback: z.string() },
}, ({ id, feedback }) => out((async () => {
  const t = (await api("GET", `/api/tasks/${id}`)) as Task;
  if (t.owner_id == null) throw new Error(`task ${id} has no owner`);
  await api("PATCH", `/api/tasks/${id}`, { status: "doing" });
  await api("POST", `/api/team/${t.owner_id}/message`, { text: feedback, taskId: id });
  return { id, status: "doing", sent_to: t.owner_id };
})()));

server.registerTool("retry_task", {
  description: "Re-queue a blocked or stuck task (status -> todo).",
  inputSchema: { id: z.number().int() },
}, ({ id }) => out(api("PATCH", `/api/tasks/${id}`, { status: "todo" }).then((t) => brief(t as Task))));

server.registerTool("blocked_overview", {
  description: "What is stuck and why: blocked tasks plus the count waiting for review, one line each.",
}, () => out(api("GET", "/api/tasks").then((all) => {
  const t = all as Task[];
  return {
    waiting_review: t.filter((x) => x.status === "review").map((x) => x.id),
    blocked: t.filter((x) => x.status === "blocked").map((x) => `#${x.id} ${x.title}: ${(x.handoff_note || "no reason recorded").split(/(?<=[.!?])\s/)[0].slice(0, 160)}`),
  };
})));

server.registerTool("list_evals", {
  description: "Eval roles with case counts and the latest runs (passed/total).",
}, () => out(api("GET", "/api/evals").then((r) => ({ ...(r as object), runs: ((r as { runs: unknown[] }).runs ?? []).slice(0, 10) }))));

server.registerTool("run_evals", {
  description: "Run one role's evals now (costs model calls).",
  inputSchema: { role: z.string() },
}, ({ role }) => out(api("POST", "/api/evals", { role })));

server.registerTool("retro_summary", {
  description: "Retrospective learnings: verdict counts and the 10 latest items.",
}, () => out(api("GET", "/api/retro").then((r) => {
  const { stats, rows } = r as { stats: unknown; rows: { text: string }[] };
  return { stats, latest: rows.slice(0, 10).map((x) => ({ ...x, text: x.text.slice(0, 200) })) };
})));

server.registerTool("set_compact_tokens", {
  description: "Show the session compaction threshold (CREW_COMPACT_AT_TOKENS). Read-only: change it in the engine env and restart.",
}, () => out(Promise.resolve({ compact_at_tokens: Number(process.env.CREW_COMPACT_AT_TOKENS) || 500_000, note: "set CREW_COMPACT_AT_TOKENS in the engine .env and restart" })));

return server;
}
