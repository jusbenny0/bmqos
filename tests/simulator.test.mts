import { test } from "node:test";
import assert from "node:assert/strict";
import { demoSnapshot } from "../lib/demo.ts";
import { simulate, LOOP } from "../lib/simulator.ts";

test("simulator is deterministic and agents take turns", () => {
  const base = demoSnapshot();
  assert.deepEqual(simulate(base, 12.5), simulate(base, 12.5));
  assert.equal(simulate(base, 1).agents[0].st, "running");
  const mid = simulate(base, 10);
  assert.equal(mid.agents[1].st, "running");
  assert.equal(mid.feed[0].s, "run");
});

test("tokens and cost keep growing, PR card appears at the end of the loop", () => {
  const base = demoSnapshot();
  const a = simulate(base, 5), b = simulate(base, 30);
  assert.ok(b.tokTodayN > a.tokTodayN && a.tokTodayN > base.tokTodayN);
  assert.ok(parseFloat(b.usd.replace(/[^\d.]/g, "")) > parseFloat(a.usd.replace(/[^\d.]/g, "")));
  assert.equal(simulate(base, 39).wait[0].id, "SIM-1");
  assert.ok(simulate(base, LOOP + 1).tokTodayN > simulate(base, 39).tokTodayN);
});
