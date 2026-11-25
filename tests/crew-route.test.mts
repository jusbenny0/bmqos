import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.OS_DB = join(mkdtempSync(join(tmpdir(), "os-crewroute-")), "os.db");
process.env.OS_SESSION_SECRET = "s".repeat(40);
process.env.OS_ORIGIN = "https://os.test";
delete process.env.CREW_API_URL;
delete process.env.CREW_API_TOKEN;

const { newSession } = await import("../lib/sessions.ts");
const { makeSession } = await import("../lib/session.ts");
const route = await import("../app/api/crew/[...path]/route.ts");
const id = newSession(new Request("http://x"));
const h = { cookie: `os_session=${makeSession(id)}`, origin: "https://os.test", "content-type": "application/json" };
const ctx = (...path: string[]) => ({ params: Promise.resolve({ path }) });
const get = (url: string, ...path: string[]) => route.GET(new Request(`https://os.test/api/crew/${url}`, { headers: h }), ctx(...path)) as Promise<Response>;
const post = (url: string, body: unknown, ...path: string[]) => route.POST(new Request(`https://os.test/api/crew/${url}`, { method: "POST", headers: h, body: JSON.stringify(body) }), ctx(...path)) as Promise<Response>;

test("proxy: no session → 401 on both GET and POST", async () => {
  const noAuth = { headers: { "content-type": "application/json" } };
  const r1 = await route.GET(new Request("https://os.test/api/crew/team", noAuth), ctx("team"));
  assert.equal(r1.status, 401);
});

test("proxy GET: team/tasks/usage in mock mode match the contract shape", async () => {
  const team = await (await get("team", "team")).json() as { id: number }[];
  assert.ok(team.length > 0 && typeof team[0].id === "number");
  const tasks = await (await get("tasks", "tasks")).json() as { id: number }[];
  assert.ok(tasks.length > 0);
  const u = await get("usage?range=24h", "usage");
  assert.equal(u.status, 200);
  const bad = await get("usage?range=nope", "usage");
  assert.equal(bad.status, 400);
});

test("proxy GET: brain search/node/graph; node with / in path; unknown node 404", async () => {
  const s = await (await get("brain/search?q=bmqos", "brain", "search")).json() as { results: unknown[] };
  assert.ok(s.results.length > 0);
  const n = await get("brain/node/projects/bmqos", "brain", "node", "projects", "bmqos");
  assert.equal(n.status, 200);
  const nj = await n.json() as { id: string };
  assert.equal(nj.id, "projects/bmqos");
  const miss = await get("brain/node/x/y", "brain", "node", "x", "y");
  assert.equal(miss.status, 404);
  const g = await get("brain/graph", "brain", "graph");
  const gj = await g.json() as { nodes: unknown[] };
  assert.ok(gj.nodes.length > 0);
});

test("proxy GET: unknown path → 404", async () => {
  const r = await get("nope", "nope");
  assert.equal(r.status, 404);
});

test("proxy POST: CEO task assignment and message to employee (guarded, CSRF)", async () => {
  const r = await post("chat", { text: "assign a task" }, "chat");
  assert.equal(r.status, 200);
  const rj = await r.json() as { reply: string };
  assert.match(rj.reply, /./);
  const msg = await post("team/1/message", { text: "hi" }, "team", "1", "message");
  assert.equal(msg.status, 200);
  const empty = await post("chat", { text: "" }, "chat");
  assert.equal(empty.status, 400);
  const foreign = await route.POST(new Request("https://os.test/api/crew/chat", { method: "POST", headers: { ...h, origin: "https://evil.test" }, body: JSON.stringify({ text: "x" }) }), ctx("chat"));
  assert.equal((foreign as Response).status, 403);
});
