// stdio MCP server for the Crew engine. Env: CREW_URL (default http://localhost:3800), CREW_API_TOKEN.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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

const out = async (p: Promise<unknown>) => {
  try {
    return { content: [{ type: "text" as const, text: JSON.stringify(await p, null, 2) }] };
  } catch (e) {
    return { isError: true, content: [{ type: "text" as const, text: String(e instanceof Error ? e.message : e) }] };
  }
};

const server = new McpServer({ name: "crew-engine", version: "1.0.0" });

server.registerTool("give_task", {
  description: "Create a task in Crew (status todo).",
  inputSchema: { title: z.string(), brief: z.string(), owner_id: z.number().int().optional(), token_cap: z.number().int().optional() },
}, (a) => out(api("POST", "/api/tasks", a)));

server.registerTool("list_tasks", {
  description: "List tasks (newest first), optionally filtered by status.",
  inputSchema: { status: z.enum(["todo", "doing", "review", "done", "blocked"]).optional() },
}, ({ status }) => out(api("GET", "/api/tasks").then((t) => (status ? (t as { status: string }[]).filter((x) => x.status === status) : t))));

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

await server.connect(new StdioServerTransport());
