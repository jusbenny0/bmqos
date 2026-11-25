import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { hermesContext, MAX } from "../lib/context";
import { call, discordMessages, ensureSession, frames, merge, messagesOf, sinceBlock, toEv, type Ev } from "../lib/hermes";
import type { Snapshot } from "../lib/types";

const RUN = `run_${"a".repeat(32)}`;
const frame = (event: string, data: object): string => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const hits: string[] = [];
let srv: Server;

test.before(async () => {
  srv = createServer((req, res) => {
    hits.push(`${req.method} ${req.url} ${req.headers.authorization ?? ""} ${req.headers["x-hermes-session-key"] ?? ""}`);
    if (req.url === "/api/sessions" && req.method === "POST") { res.statusCode = 409; return res.end("{}"); }
    if (req.url?.startsWith("/api/sessions?source=discord")) return res.end(JSON.stringify({ data: [{ id: "discord_1" }] }));
    if (req.url?.startsWith("/api/sessions/discord_1/messages")) return res.end(JSON.stringify({ data: [{ role: "user", content: "hi token=abcdefghij", timestamp: 1000 }, { role: "tool", content: "x", timestamp: 1001 }, { role: "assistant", content: [{ type: "text", text: "hey" }], timestamp: 1002 }] }));
    if (req.url?.startsWith("/api/sessions/bmqos-owner/messages")) return res.end(JSON.stringify({ data: [{ role: "assistant", content: "earlier", timestamp: 1001 }] }));
    if (req.url?.endsWith("/chat/stream")) {
      res.setHeader("Content-Type", "text/event-stream");
      res.write(frame("run.started", {}) + frame("assistant.delta", { delta: "Ah" }).slice(0, 20));
      return setTimeout(() => res.end(frame("assistant.delta", { delta: "Ah" }).slice(20) + frame("tool.started", { tool_name: "terminal", args: { cmd: "rm -rf /" } }) + frame("approval.request", { run_id: RUN, description: "delete", command: "rm -rf /" }) + frame("assistant.delta", { delta: "ha" }) + frame("done", {})), 10);
    }
    res.statusCode = 404; res.end("{}");
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  process.env.HERMES_API_URL = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  process.env.HERMES_API_KEY = "testkey-123456789";
});
test.after(() => { srv.close(); });

test("session: 409 = already exists, key goes in Authorization", async () => {
  await ensureSession();
  assert.match(hits[0], /POST \/api\/sessions Bearer testkey-123456789/);
});

test("SSE from Hermes → our events drop tool args, a frame split in half still works", async () => {
  const r = await call("/api/sessions/bmqos-owner/chat/stream", { method: "POST", headers: { "X-Hermes-Session-Key": "bmqos-owner" }, body: "{}" });
  const out: Ev[] = [];
  for await (const f of frames(r.body!)) { const e = toEv(f.event, f.data); if (e) out.push(e); }
  assert.deepEqual(out, [{ delta: "Ah" }, { tool: { name: "terminal", state: "run" } }, { approval: { run: RUN, title: "delete", command: "rm -rf /", choices: ["once", "deny"] } }, { delta: "ha" }, { done: true }]);
  assert.ok(!JSON.stringify(out.filter((e) => !("approval" in e))).includes("rm -rf"));
  assert.match(hits.at(-1)!, /bmqos-owner$/);
});

test("approval without a valid run id is dropped, errors stay generic", () => {
  assert.equal(toEv("approval.request", { run_id: "../x" }), null);
  assert.deepEqual(toEv("error", { message: "secret details" }), { error: "The Assistant didn't respond. Try again." });
  // a Claude rate limit is recognized, but details still aren't leaked
  assert.deepEqual(toEv("error", { message: "HTTP 429 rate_limit_error secret" }), { error: "Hit Claude's rate limit – the Assistant can't respond right now. Try again in a few minutes." });
  assert.equal(toEv("run.started", {}), null);
});

test("timeline: Discord + BMQOS merged in order, tool messages dropped, scrub, Meanwhile block only newer", async () => {
  const d = await discordMessages(), b = await messagesOf("bmqos-owner", "bmqos");
  assert.deepEqual(d.map((m) => m.text), ["hi token=[hidden]", "hey"]);
  assert.deepEqual(merge(d, b).map((m) => `${m.src}:${m.text}`), ["discord:hi token=[hidden]", "bmqos:earlier", "discord:hey"]);
  assert.equal(sinceBlock(d, b), "Hermes: hey");
  assert.equal(sinceBlock(d, []).split("\n").length, 2);
});

test("context: Discord delta + deploy + action log, capped at MAX", () => {
  const d = { servers: [], agents: [], kpi: { failed: 0 }, errors: [], wait: Array.from({ length: 900 }, (_, i) => ({ id: `ABC-${i}`, t: "x".repeat(50), kind: "Question", age: "1 h", ageMin: i })) } as unknown as Snapshot;
  const t = hermesContext(d, [], "", "", { deploy: "bmqos: done", discord: "Owner: ".padEnd(5000, "y") });
  assert.ok(t.length <= MAX);
  assert.match(t, /Meanwhile on Discord/);
  assert.match(t, /<untrusted_data>[\s\S]*Meanwhile[\s\S]*<\/untrusted_data>/);
  assert.match(t, /Deploy: bmqos: done/);
  assert.match(t, /open\|answer\|approve\|reject\|create/);
  assert.ok(!hermesContext(d, [], "", "").includes("Meanwhile"));
});
