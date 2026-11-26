// MCP test: npx tsx scripts/mcp-test.mts (runs the server against a mock API and calls every tool)
import assert from "node:assert/strict";
import http from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { spawn } from "node:child_process";

const seen: string[] = [];
const mock = http.createServer((req, res) => {
  let b = "";
  req.on("data", (c) => (b += c));
  req.on("end", () => {
    seen.push(`${req.method} ${req.url} ${req.headers.authorization} ${b}`);
    res.setHeader("Content-Type", "application/json");
    if (req.headers.authorization !== "Bearer t0k") { res.statusCode = 401; return res.end('{"error":"unauthorized"}'); }
    if (req.url === "/api/tasks" && req.method === "GET") return res.end('[{"id":1,"status":"todo"},{"id":2,"status":"done"},{"id":4,"title":"B","status":"blocked","handoff_note":"Needs key. More text."}]');
    if (req.url === "/api/tasks/7") return res.end('{"id":7,"title":"T7","status":"doing","owner_id":3}');
    if (req.url === "/api/retro") return res.end('{"stats":[],"rows":[{"id":1,"text":"x"}]}');
    if (req.url === "/api/evals" && req.method === "GET") return res.end('{"roles":[],"runs":[]}');
    if (req.url?.startsWith("/api/brand/acme/assets")) return res.end("[]");
    if (req.url === "/api/brand") return res.end('{"id":"acme","url":"/#brand&id=acme"}');
    res.end('{"ok":true}');
  });
});
await new Promise<void>((r) => mock.listen(0, r));
const url = `http://127.0.0.1:${(mock.address() as { port: number }).port}`;

const run = async (token: string) => {
  const c = new Client({ name: "test", version: "0" });
  await c.connect(new StdioClientTransport({ command: "npx", args: ["tsx", "mcp/server.mts"], env: { ...(process.env as Record<string, string>), CREW_URL: url, CREW_API_TOKEN: token, BRAND_URL: url, OS_BRAND_TOKEN: token } }));
  return c;
};
const text = (r: unknown) => (r as { content: { text: string }[] }).content[0].text;

const c = await run("t0k");
const names = (await c.listTools()).tools.map((t) => t.name).sort();
assert.deepEqual(names, ["answer", "approve", "approve_idea", "blocked_overview", "create_brand_project", "discuss_idea", "generate_brand_images", "give_task", "list_brand_assets", "list_evals", "list_providers", "list_tasks", "retro_summary", "retry_task", "return_task", "run_evals", "set_compact_tokens", "spend_summary", "task_status", "team_status"]);
await c.callTool({ name: "give_task", arguments: { title: "T", brief: "B" } });
assert.equal(JSON.parse(text(await c.callTool({ name: "list_tasks", arguments: { status: "done" } }))).length, 1);
await c.callTool({ name: "task_status", arguments: { id: 5 } });
await c.callTool({ name: "approve", arguments: { id: 5 } });
await c.callTool({ name: "answer", arguments: { text: "ano" } });
await c.callTool({ name: "answer", arguments: { text: "ano", employee_id: 3, task_id: 5 } });
await c.callTool({ name: "team_status", arguments: {} });
await c.callTool({ name: "spend_summary", arguments: { range: "7d" } });
assert.match(text(await c.callTool({ name: "blocked_overview", arguments: {} })), /#4 B: Needs key\./);
await c.callTool({ name: "retry_task", arguments: { id: 7 } });
await c.callTool({ name: "return_task", arguments: { id: 7, feedback: "fix it" } });
await c.callTool({ name: "list_evals", arguments: {} });
await c.callTool({ name: "run_evals", arguments: { role: "qa" } });
assert.match(text(await c.callTool({ name: "retro_summary", arguments: {} })), /latest/);
assert.match(text(await c.callTool({ name: "set_compact_tokens", arguments: {} })), /compact_at_tokens/);
await c.callTool({ name: "approve_idea", arguments: { id: 3, answers: ["x"] } });
assert.ok(seen.some((l) => l.startsWith("POST /api/ideas/3/approve ")), "approve_idea hits the ideas API");
await c.callTool({ name: "create_brand_project", arguments: { name: "Acme" } });
assert.ok(seen.some((l) => l.startsWith("POST /api/brand ") && l.includes("Bearer")), "create_brand_project hits the panel brand API");
assert.match(text(await c.callTool({ name: "list_brand_assets", arguments: { project: "acme" } })), /^\[\]$/);
const joined = seen.join("\n");
for (const s of ['POST /api/tasks Bearer t0k {"title":"T"', "GET /api/tasks/5", 'PATCH /api/tasks/5 Bearer t0k {"status":"done"}', 'POST /api/chat Bearer t0k {"text":"ano"}', 'POST /api/team/3/message Bearer t0k {"text":"ano","taskId":5}', "GET /api/team ", "GET /api/usage?range=7d", 'PATCH /api/tasks/7 Bearer t0k {"status":"todo"}', 'POST /api/team/3/message Bearer t0k {"text":"fix it","taskId":7}', 'POST /api/evals Bearer t0k {"role":"qa"}'])
  assert.ok(joined.includes(s), `missing: ${s}\n${joined}`);
await c.close();

const bad = await run("bad");
const r = await bad.callTool({ name: "team_status", arguments: {} });
assert.equal((r as { isError?: boolean }).isError, true);
assert.match(text(r), /401/);
await bad.close();

// HTTP transport: 401 without/with wrong token, tools list with token, call reaches the engine.
const hport = 38000 + (process.pid % 1000);
const srv = spawn("npx", ["tsx", "mcp/server.mts", "--http"], { env: { ...process.env, CREW_URL: url, CREW_API_TOKEN: "t0k", BRAND_URL: url, OS_BRAND_TOKEN: "t0k", CREW_MCP_PORT: String(hport), CREW_MCP_HOST: "127.0.0.1" }, stdio: "ignore" });
const endpoint = `http://127.0.0.1:${hport}/mcp`;
for (let i = 0; i < 60; i++) { try { await fetch(endpoint); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
assert.equal((await fetch(endpoint, { method: "POST" })).status, 401);
assert.equal((await fetch(endpoint, { method: "POST", headers: { Authorization: "Bearer nope" } })).status, 401);
const hc = new Client({ name: "test", version: "0" });
await hc.connect(new StreamableHTTPClientTransport(new URL(endpoint), { requestInit: { headers: { Authorization: "Bearer t0k" } } }));
assert.equal((await hc.listTools()).tools.length, names.length);
assert.match(text(await hc.callTool({ name: "list_tasks", arguments: {} })), /"id":1/);
await hc.close();
srv.kill();
mock.close();
console.log("mcp ok");
