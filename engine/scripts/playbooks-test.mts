// Playbooks: built-ins load and validate, user overrides merge/reset, default selection, API handlers, CEO catalogue.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-"));
process.env.CREW_PLAYBOOKS_DIR = dir;
const P = await import("../lib/playbooks.ts");
const list = await import("../app/api/playbooks/route.ts");
const one = await import("../app/api/playbooks/[id]/route.ts");
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const patch = (body: unknown) => new Request("http://x", { method: "PATCH", body: JSON.stringify(body) });

assert.deepEqual(P.listPlaybooks(), ["api", "docs", "web-app", "web-landing"]);
for (const id of P.listPlaybooks()) {
  const p = P.loadPlaybook(id)!;
  assert.ok(p.steps.length && p.security_rules.length && p.tech_stack.length, id);
  assert.ok(fs.existsSync(path.join(process.cwd(), "playbooks", `${id}.md`)), `${id}.md`);
  assert.ok(P.playbookBrief(p).includes("Security rules:"));
}
const wl = P.loadPlaybook("web-landing")!;
assert.ok(wl.steps.some((s) => s.gate === "visual" && /8\.5/.test(s.acceptance)), "visual gate >= 8.5");
assert.ok(Object.keys(wl.extra_sections!).some((k) => k.startsWith("Findings from web-lab comparison (TODO")));
assert.ok(P.loadPlaybook("web-app")!.tech_stack.some((s) => /Drizzle/.test(s)));
assert.equal(P.loadPlaybook("../etc/passwd"), null);
assert.equal(P.loadPlaybook("nope"), null);

// override merges over the built-in, invalid ones are rejected and ignored
assert.equal(P.saveOverride("api", { tech_stack: "bad" }), null);
assert.equal(P.saveOverride("api", { steps: [] }), null);
assert.deepEqual(P.saveOverride("api", { tech_stack: ["Go"] })!.tech_stack, ["Go"]);
assert.equal(P.loadPlaybook("api")!.title, "HTTP API / backend service");
fs.writeFileSync(path.join(dir, "docs.json"), "{broken");
assert.equal(P.loadPlaybook("docs")!.id, "docs", "broken override falls back to built-in");
assert.equal(P.resetOverride("api"), true);
assert.ok(P.loadPlaybook("api")!.tech_stack.some((s) => /Hono/.test(s)));

// custom playbook (full definition) and default selection
const custom = { title: "Mine", description: "d", needs: { visual: false, qa: false, security: false }, steps: [{ role: "builder", title: "Do", acceptance: "ok" }], security_rules: [], tech_stack: [] };
assert.ok(P.saveOverride("mine", custom));
assert.ok(P.listPlaybooks().includes("mine"));
assert.equal(P.defaultPlaybook(), undefined);
P.setDefault("web-landing");
assert.equal(P.defaultPlaybook(), "web-landing");
assert.match(P.playbookCatalog(), /web-landing \(default\)/);

// API
let r = await list.GET();
const j = (await r.json()) as { id: string; default: boolean; overridden: boolean }[];
assert.equal(j.find((x) => x.id === "web-landing")!.default, true);
assert.equal(j.find((x) => x.id === "mine")!.overridden, true);
r = await one.GET(new Request("http://x"), ctx("web-app"));
assert.match(((await r.json()) as { brief: string }).brief, /Playbook: Web application/);
assert.equal((await one.GET(new Request("http://x"), ctx("zzz"))).status, 404);
r = await one.PATCH(patch({ security_rules: ["custom rule"] }), ctx("web-app"));
assert.deepEqual(((await r.json()) as { security_rules: string[] }).security_rules, ["custom rule"]);
assert.equal((await one.PATCH(patch({ steps: "x" }), ctx("web-app"))).status, 400);
assert.equal((await one.PATCH(patch(["x"]), ctx("web-app"))).status, 400);
assert.equal((await one.PATCH(patch({}), ctx("../x"))).status, 400);
r = await one.PATCH(patch({ reset: true }), ctx("web-app"));
assert.ok(((await r.json()) as { security_rules: string[] }).security_rules.length > 1);
assert.equal((await list.PATCH(patch({ default: "nope" }))).status, 400);
assert.equal(((await (await list.PATCH(patch({ default: "docs" }))).json()) as { default: string }).default, "docs");
assert.equal(((await (await list.PATCH(patch({ default: null }))).json()) as { default: null }).default, null);
console.log("playbooks-test: ok");
