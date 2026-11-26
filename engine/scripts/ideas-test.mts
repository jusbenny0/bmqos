// Ideas: discussion with mock asker (roles, models, advisor), token cap, parsing limits, approval -> tasks, API handlers.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ideas-"));
process.chdir(tmp); // db() writes data/crew.db under cwd
process.env.CREW_MOCK = "1";
process.env.CREW_ADVISORS_DIR = path.join(tmp, "advisors");
const I = await import("../lib/ideas.ts");
const { db } = await import("../lib/db.ts");
const list = await import("../app/api/ideas/route.ts");
const one = await import("../app/api/ideas/[id]/route.ts");
const appr = await import("../app/api/ideas/[id]/approve/route.ts");
const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });
const post = (body: unknown) => new Request("http://x", { method: "POST", body: JSON.stringify(body) });

const synth = JSON.stringify({
  summary: "S", questions: [1, 2, 3, 4, 5].map((i) => ({ q: `Q${i}`, recommended: `R${i}` })),
  tasks: [{ title: "T1", brief: "B1", size: "S", tokens: 5000 }, { title: "T2", brief: "B2", size: "X", tokens: -1 }, { title: "", brief: "no title", size: "M" }],
});
const calls: string[] = [];
const ask = (perCall: number) => async (role: string, model: "haiku" | "sonnet") => {
  calls.push(`${role}:${model}`);
  return { text: model === "sonnet" ? `intro ${synth} outro` : `opinion of ${role}`, tokens: perCall };
};

// discussion: 3 roles on haiku, CEO on sonnet, questions capped at 3, bad tasks cleaned
let idea = I.createIdea("a CRM for dentists");
assert.equal(idea.status, "discussing");
idea = await I.runDiscussion(idea.id, ask(100));
assert.deepEqual(calls, ["Designer:haiku", "Builder:haiku", "Security:haiku", "CEO:sonnet"]);
assert.equal(idea.status, "ready");
assert.equal(idea.tokens, 400);
assert.equal(idea.opinions.length, 3);
assert.equal(idea.synthesis!.questions.length, 3);
assert.deepEqual(idea.synthesis!.tasks.map((t) => [t.title, t.size]), [["T1", "S"], ["T2", "M"]]);
assert.ok(idea.synthesis!.tasks[1].tokens > 0);

// advisor joins when one exists
fs.mkdirSync(path.join(tmp, "advisors", "mentor", "kb"), { recursive: true });
calls.length = 0;
await I.runDiscussion(I.createIdea("x").id, ask(1));
assert.deepEqual(calls.slice(0, 4), ["Designer:haiku", "Builder:haiku", "Security:haiku", "Advisor:mentor:haiku"]);

// cap: stops asking roles, synthesis without LLM
calls.length = 0;
const capped = await I.runDiscussion(I.createIdea("big").id, ask(I.IDEA_TOKEN_CAP));
assert.deepEqual(calls, ["Designer:haiku"], "no further calls after the cap");
assert.equal(capped.status, "ready");
assert.match(capped.synthesis!.summary, /cap/i);
assert.deepEqual(capped.synthesis!.tasks, []);
assert.equal(I.IDEA_TOKEN_CAP, 60_000);

// failing role is recorded, discussion continues; failing synthesis -> failed
const flaky = async (role: string, model: "haiku" | "sonnet") => { if (role === "Builder") throw new Error("boom"); return { text: model === "sonnet" ? synth : "ok", tokens: 1 }; };
const f = await I.runDiscussion(I.createIdea("y").id, flaky);
assert.equal(f.status, "ready");
assert.match(f.opinions.find((o) => o.role === "Builder")!.text, /unavailable/);
const dead2 = await I.runDiscussion(I.createIdea("z2").id, async (_r, m) => { if (m === "sonnet") throw new Error("x"); return { text: "ok", tokens: 1 }; });
assert.equal(dead2.status, "failed");

// approval: tasks created with decisions, not twice
const before = (db().prepare("SELECT COUNT(*) n FROM tasks").get() as { n: number }).n;
const a = I.approveIdea(idea.id, ["my answer"]);
assert.ok(!("error" in a) && a.status === "approved" && a.task_ids.length === 2);
const t = db().prepare("SELECT * FROM tasks WHERE id = ?").get(a.task_ids[0]) as { title: string; brief: string; status: string; token_cap: number };
assert.equal(t.title, "T1"); assert.equal(t.status, "todo");
assert.match(t.brief, /Q1 → my answer/); assert.match(t.brief, /Q2 → R2/);
assert.equal((db().prepare("SELECT COUNT(*) n FROM tasks").get() as { n: number }).n, before + 2);
assert.ok("error" in I.approveIdea(idea.id), "second approve refused");
assert.ok("error" in I.approveIdea(9999));

// API
assert.equal((await list.POST(post({}))).status, 400);
const created = await list.POST(post({ text: "api idea" }));
assert.equal(created.status, 202);
const cid = ((await created.json()) as { id: number }).id;
let st = "discussing";
for (let i = 0; i < 50 && st === "discussing"; i++) { await new Promise((r) => setTimeout(r, 50)); st = ((await (await one.GET(new Request("http://x"), ctx(cid))).json()) as { status: string }).status; }
assert.equal(st, "ready", "mock discussion finishes in the background");
assert.equal((await one.GET(new Request("http://x"), ctx(9999))).status, 404);
assert.equal((await appr.POST(post({}), ctx(9999))).status, 404);
const ok = await appr.POST(post({}), ctx(cid));
assert.equal(ok.status, 200);
assert.equal((await appr.POST(post({}), ctx(cid))).status, 409);
assert.ok(((await (await list.GET()).json()) as unknown[]).length >= 6);
// no silent mock: without CREW_MOCK and without the claude CLI the asker must fail
{
  const m = process.env.CREW_MOCK, pa = process.env.PATH;
  delete process.env.CREW_MOCK; process.env.PATH = "/nonexistent";
  await assert.rejects(I.defaultAsk()("CEO", "sonnet", "x"), /claude CLI/);
  process.env.CREW_MOCK = m; process.env.PATH = pa;
}
console.log("ideas ok");
