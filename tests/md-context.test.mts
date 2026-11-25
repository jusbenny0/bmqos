import test from "node:test";
import assert from "node:assert/strict";
import { md } from "../lib/md";
import { hermesContext, MAX } from "../lib/context";
import type { Snapshot } from "../lib/types";

test("md: bold, link to a card in BMQOS, code, list, no HTML or javascript:", () => {
  const h = md("**Questions**\n- [ABC-500](/ABC/issues/ABC-500) and `code`\n- [x](javascript:alert(1)) <script>x</script>");
  assert.match(h, /<strong>Questions<\/strong>/);
  assert.match(h, /<a href="#waiting&amp;issue=ABC-500">ABC-500<\/a>/);
  assert.match(h, /<code>code<\/code>/);
  assert.match(h, /<ul><li>/);
  assert.doesNotMatch(h, /javascript:|<script>/);
});

test("Hermes context: on fire, waiting, screen, limit, no secrets", () => {
  const d = {
    servers: [{ n: "Dokploy", where: "LAN", target: "10.0.0.2:3000", up: false, ms: 0, at: "" }],
    agents: [{ n: "Worker", st: "error", err: "crashed", role: "x", id: "w" }, { n: "Hermes", st: "running", cur: "ABC-1", role: "x", id: "h" }],
    kpi: { failed: 0 }, errors: [],
    wait: [{ id: "ABC-9", t: "Decide token: pcp_abcdefghijklmnopqrst", kind: "Question", age: "2 h", ageMin: 120 }],
  } as unknown as Snapshot;
  const t = hermesContext(d, [], "waiting", "ABC-9");
  assert.match(t, /BMQOS/);
  assert.match(t, /Dokploy is down/);
  assert.match(t, /Worker is in error/);
  assert.match(t, /ABC-9 · Decide/);
  assert.match(t, /Tasks.*ABC-9/);
  assert.doesNotMatch(t, /pcp_abcdefghijklmnop/);
  assert.ok(hermesContext({ ...d, wait: Array.from({ length: 900 }, (_, i) => ({ id: `ABC-${i}`, t: "x".repeat(50), kind: "Question", age: "1 h", ageMin: i })) } as unknown as Snapshot, [], "", "").length <= MAX);
});

test("Hermes context: assigning work and the agent list under the cap", () => {
  const agents = Array.from({ length: 80 }, (_, i) => ({ n: `Agent${i}`, st: "idle", role: "does an important thing number " + i, id: `a${i}` }));
  const d = { servers: [], agents, kpi: { failed: 0 }, errors: [], wait: [] } as unknown as Snapshot;
  const t = hermesContext(d, [], "", "", { projects: ["Ops Panel", "DL"] });
  assert.match(t, /Assigning work/);
  assert.match(t, /"do":"create"/);
  assert.match(t, /do:"update"/);
  assert.match(t, /- Agent0 – does an important thing/);
  assert.match(t, /Projects: Ops Panel, DL/);
  const teamLen = t.slice(t.indexOf("Agents (name"), t.indexOf("What the owner is seeing right now") > t.indexOf("Agents (name") ? undefined : t.indexOf("What the owner is seeing right now")).split("\n\n")[0].length;
  assert.ok(teamLen <= 1500, String(teamLen));
  assert.ok(t.length <= MAX);
});
