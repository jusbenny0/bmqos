// MCP test: npx tsx scripts/mcp-test.mts (runs the server against a mock API and calls every tool)
import assert from "node:assert/strict";
import http from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const seen: string[] = [];
const mock = http.createServer((req, res) => {
  let b = "";
  req.on("data", (c) => (b += c));
  req.on("end", () => {
    seen.push(`${req.method} ${req.url} ${req.headers.authorization} ${b}`);
    res.setHeader("Content-Type", "application/json");
    if (req.headers.authorization !== "Bearer t0k") { res.statusCode = 401; return res.end('{"error":"unauthorized"}'); }
    if (req.url === "/api/tasks" && req.method === "GET") return res.end('[{"id":1,"status":"todo"},{"id":2,"status":"done"}]');
    res.end('{"ok":true}');
  });
});
await new Promise<void>((r) => mock.listen(0, r));
const url = `http://127.0.0.1:${(mock.address() as { port: number }).port}`;

const run = async (token: string) => {
  const c = new Client({ name: "test", version: "0" });
  await c.connect(new StdioClientTransport({ command: "npx", args: ["tsx", "mcp/server.mts"], env: { ...(process.env as Record<string, string>), CREW_URL: url, CREW_API_TOKEN: token } }));
  return c;
};
const text = (r: unknown) => (r as { content: { text: string }[] }).content[0].text;

const c = await run("t0k");
const names = (await c.listTools()).tools.map((t) => t.name).sort();
assert.deepEqual(names, ["answer", "approve", "give_task", "list_tasks", "spend_summary", "task_status", "team_status"]);
await c.callTool({ name: "give_task", arguments: { title: "T", brief: "B" } });
assert.equal(JSON.parse(text(await c.callTool({ name: "list_tasks", arguments: { status: "done" } }))).length, 1);
await c.callTool({ name: "task_status", arguments: { id: 5 } });
await c.callTool({ name: "approve", arguments: { id: 5 } });
await c.callTool({ name: "answer", arguments: { text: "ano" } });
await c.callTool({ name: "answer", arguments: { text: "ano", employee_id: 3, task_id: 5 } });
await c.callTool({ name: "team_status", arguments: {} });
await c.callTool({ name: "spend_summary", arguments: { range: "7d" } });
const joined = seen.join("\n");
for (const s of ['POST /api/tasks Bearer t0k {"title":"T"', "GET /api/tasks/5", 'PATCH /api/tasks/5 Bearer t0k {"status":"done"}', 'POST /api/chat Bearer t0k {"text":"ano"}', 'POST /api/team/3/message Bearer t0k {"text":"ano","taskId":5}', "GET /api/team ", "GET /api/usage?range=7d"])
  assert.ok(joined.includes(s), `missing: ${s}\n${joined}`);
await c.close();

const bad = await run("bad");
const r = await bad.callTool({ name: "team_status", arguments: {} });
assert.equal((r as { isError?: boolean }).isError, true);
assert.match(text(r), /401/);
await bad.close();
mock.close();
console.log("mcp ok");
