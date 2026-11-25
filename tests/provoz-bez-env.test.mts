import test from "node:test";
import assert from "node:assert/strict";

test("no env: empty services and findings, live:false, nothing throws", async () => {
  process.env.OS_DB = ":memory:";
  for (const k of ["GITHUB_TOKEN", "DOKPLOY_URL", "DOKPLOY_TOKEN", "OS_AGENTS", "OS_NETMAP_STATIC", "PVE_API_URL"]) delete process.env[k];
  const { collect } = await import("../lib/services.ts"), { findings } = await import("../lib/watch.ts");
  const c = await collect();
  assert.deepEqual(c.svcs, []);
  assert.deepEqual(await findings(), []);
  assert.equal(c.live.dokploy, false); assert.equal(c.live.github, false); assert.deepEqual(c.live.agents, {});
});
