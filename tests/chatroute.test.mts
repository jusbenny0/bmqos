import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

process.env.OS_DB = join(mkdtempSync(join(tmpdir(), "os-chat-")), "os.db");
process.env.OS_SESSION_SECRET = "s".repeat(40);
process.env.OS_ORIGIN = "https://os.test";
const RUN = `run_${"b".repeat(32)}`;
let srv: Server, aborted = 0, conn = 0, approvals = 0, approvalStatus = 200;
const gate: { open: () => void } = { open: () => {} };

test.before(async () => {
  srv = createServer((req, res) => {
    if (req.url === "/api/sessions" && req.method === "POST") { res.statusCode = 409; return res.end("{}"); }
    if (req.url?.includes("/messages") || req.url?.startsWith("/api/sessions?")) return res.end(JSON.stringify({ data: [] }));
    if (req.url?.endsWith("/chat/stream")) {
      res.setHeader("Content-Type", "text/event-stream");
      conn++;
      req.on("close", () => { if (!res.writableEnded) aborted++; });
      res.write(`event: approval.request\ndata: ${JSON.stringify({ run_id: RUN, description: "delete", command: "rm -rf /tmp/x token=abcdefghijkl" })}\n\n`);
      gate.open = () => res.end("event: done\ndata: {}\n\n");
      return;
    }
    if (req.url === `/v1/runs/${RUN}/approval`) { approvals++; res.statusCode = approvalStatus; return res.end("{}"); }
    if (req.url?.startsWith("/pc")) return res.end("[]");
    res.statusCode = 404; res.end("{}");
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  process.env.PAPERCLIP_API_URL = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/pc`;
  process.env.HERMES_API_URL = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  process.env.HERMES_API_KEY = "testkey-123456789";
});
test.after(() => { srv.close(); });

const { newSession } = await import("../lib/sessions.ts");
const { makeSession } = await import("../lib/session.ts");
const chat = await import("../app/api/chat/route.ts");
const appr = await import("../app/api/chat/approval/route.ts");
const id = newSession(new Request("http://x"));
const h = { cookie: `os_session=${makeSession(id)}`, origin: "https://os.test", "content-type": "application/json" };
const post = (b: unknown) => chat.POST(new Request("https://os.test/api/chat", { method: "POST", headers: h, body: JSON.stringify(b) })) as Promise<Response>;
const ap = (choice: string) => appr.POST(new Request("https://os.test/api/chat/approval", { method: "POST", headers: h, body: JSON.stringify({ run: RUN, choice }) })) as Promise<Response>;
const until = async (f: () => boolean): Promise<void> => { for (let i = 0; i < 800 && !f(); i++) await new Promise((r) => setTimeout(r, 25)); assert.ok(f()); };

test("two concurrent POSTs: the second gets 409, cancel aborts upstream and releases the lock", async () => {
  const [a, b] = await Promise.all([post({ text: "hi" }), post({ text: "hi 2" })]);
  const codes = [a.status, b.status].sort();
  assert.deepEqual(codes, [200, 409]);
  const ok = a.status === 200 ? a : b;
  await until(() => conn === 1);
  await ok.body!.cancel();
  await until(() => aborted === 1);
  const c = await post({ text: "again" });
  assert.equal(c.status, 200);
  await until(() => conn === 2);
  await c.body!.cancel();
  await until(() => aborted === 2);
});

test("approval: GET after reload returns pending, the command is scrubbed, double click = 409", async () => {
  const r = await post({ text: "delete" });
  const rd = r.body!.getReader();
  await rd.read(); // approval event
  gate.open();
  const g = await chat.GET(new Request("https://os.test/api/chat", { headers: h }));
  const j = (await g.json()) as { approvals: { run: string; command: string }[] };
  assert.equal(j.approvals[0].run, RUN);
  assert.ok(j.approvals[0].command.includes("rm -rf") && !j.approvals[0].command.includes("abcdefghijkl"));
  const [x, y] = [await ap("once"), await ap("once")];
  assert.deepEqual([x.status, y.status], [200, 409]);
  assert.equal(approvals, 1);
});

test("approval: upstream 404 → 409, invalid image and foreign origin rejected", async () => {
  const r = await post({ text: "again" });
  await r.body!.getReader().read();
  gate.open();
  approvalStatus = 404;
  assert.equal((await ap("deny")).status, 409);
  const bad = await post({ text: "x", images: [{ dataUrl: "data:image/png;base64,AAAAAAAA" }] });
  assert.equal(bad.status, 400);
  const foreign = await chat.POST(new Request("https://os.test/api/chat", { method: "POST", headers: { ...h, origin: "https://evil.test" }, body: "{}" }));
  assert.equal((foreign as Response).status, 403);
});
