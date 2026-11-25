import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

test("agent: missing disk-tidy = 502 error, not 200", async () => {
  const port = 19477, token = "x".repeat(20);
  const p = spawn(process.execPath, ["scripts/storage-agent.mjs"], { env: { PATH: "/nonexistent", AGENT_TOKEN: token, AGENT_PORT: String(port), AGENT_ACT: "1" }, stdio: "ignore" });
  try {
    let r: Response | null = null;
    for (let i = 0; i < 30 && !r; i++) { r = await fetch(`http://127.0.0.1:${port}/act?name=tidy`, { method: "POST", headers: { Authorization: `Bearer ${token}` } }).catch(() => null); if (!r) await new Promise((x) => setTimeout(x, 100)); }
    assert.equal(r?.status, 502);
  } finally { p.kill(); }
});
