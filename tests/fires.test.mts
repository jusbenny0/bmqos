import test from "node:test";
import assert from "node:assert/strict";
import { fires } from "../lib/fires.ts";
import type { Snapshot } from "../lib/types.ts";

test("failed runs and limits aren't a red-flag card, Hermes handles those", () => {
  const d = { servers: [], agents: [], kpi: { failed: 5 }, errors: [{ a: "CTO", msg: "5-hour limit" }] } as unknown as Snapshot;
  assert.deepEqual(fires(d), []);
});
