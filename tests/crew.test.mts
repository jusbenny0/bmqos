import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.OS_DB = join(mkdtempSync(join(tmpdir(), "os-crew-")), "os.db"); // own DB: test files run in parallel
const crew = await import("../lib/crew");

const hits: string[] = [];
let srv: Server;
test.before(async () => {
  srv = createServer((req, res) => {
    hits.push(`${req.method} ${req.url} ${req.headers.authorization}`);
    if (req.url === "/api/tasks/9") { res.statusCode = 404; return res.end("{}"); }
    if (req.url?.startsWith("/api/brain/")) { res.end(JSON.stringify({ ok: 1, nodes: [], links: [] })); return; }
    res.end(JSON.stringify({ ok: 1 }));
  });
  await new Promise<void>((r) => srv.listen(0, r));
  process.env.CREW_API_URL = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/`;
  process.env.CREW_API_TOKEN = "tok";
});
test.after(() => srv.close());

test("live: Bearer token and paths follow the contract, 404 propagates", async () => {
  await crew.usage("7d"); await crew.transcript(2, 5); await crew.message(2, "hi");
  assert.deepEqual(hits.slice(0, 3), ["GET /api/usage?range=7d Bearer tok", "GET /api/team/2/transcript?after=5 Bearer tok", "POST /api/team/2/message Bearer tok"]);
  await assert.rejects(crew.task(9), (e: crew.CrewError) => e.status === 404);
});
test("live: CEO chat and brain (search/node/graph) hit the right paths with a Bearer token", async () => {
  hits.length = 0;
  await crew.chat("task brief"); await crew.brainSearch("bmqos"); await crew.brainNode("projects/bmqos"); await crew.brainGraph();
  assert.deepEqual(hits, [
    "POST /api/chat Bearer tok",
    "GET /api/brain/search?q=bmqos Bearer tok",
    "GET /api/brain/node/projects/bmqos Bearer tok",
    "GET /api/brain/graph Bearer tok",
  ]);
});
test("mock without CREW_API_URL has the contract shape", async () => {
  delete process.env.CREW_API_URL;
  assert.equal(crew.live(), false);
  const team = await crew.team();
  assert.ok(team[0].tokens_today > 0);
  assert.ok(team.length >= 3);
  const u24 = await crew.usage("24h");
  assert.equal(u24.byEmployee.length, team.filter((m) => m.tokens_today > 0).length);
  const u7 = await crew.usage("7d");
  assert.equal(u7.byEmployee.length, team.length);
  assert.equal(u7.compare, null); // demo has no external comparison
  await assert.rejects(crew.task(999), (e: crew.CrewError) => e.status === 404);
});
test("mock: CEO chat returns a sample reply, brain search and graph have connected nodes", async () => {
  const r = await crew.chat("hi");
  assert.match(r.reply, /demo/); // lib/crew.ts mock text is translated by another file owner
  const hits2 = await crew.brainSearch("bmqos");
  assert.ok(hits2.results.length > 0);
  assert.ok(hits2.results.every((h) => h.score > 0));
  const node = await crew.brainNode("projects/bmqos");
  assert.equal(node.id, "projects/bmqos");
  assert.ok(node.links.length > 0);
  await assert.rejects(async () => crew.brainNode("neexistuje/nic"), (e: crew.CrewError) => e.status === 404);
  const graph = await crew.brainGraph();
  assert.ok(graph.nodes.length > 0 && graph.links.length > 0);
  const ids = new Set(graph.nodes.map((n) => n.id));
  assert.ok(graph.links.every((l) => ids.has(l.source) && ids.has(l.target)));
});
