import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.OS_DB = join(mkdtempSync(join(tmpdir(), "cfg-")), "t.db");
const c = await import("../lib/config.ts");
const ok = { company: { name: " Acme ", accent: "#112233", owner: "Jo" }, agents: [{ name: "Lead", role: "x" }, { name: " ", role: "" }], engine: { mode: "demo" }, goal: { goal: "g" } };

test("parseSetup validates and trims", () => {
  const s = c.parseSetup(ok)!;
  assert.equal(s.company.name, "Acme"); assert.equal(s.agents.length, 1); assert.equal(s.goal.model, "sonnet");
  assert.equal(c.parseSetup({ ...ok, company: { name: "" } }), null);
  assert.equal(c.parseSetup({ ...ok, agents: [] }), null);
  assert.equal(c.parseSetup({ ...ok, company: { name: "A", accent: "red" } }), null);
  assert.equal(c.parseSetup({ ...ok, engine: { mode: "crew", url: "ftp://x", token: "t" } }), null);
});
test("saveSetup persists, onboarded flips, crew connection comes from DB", () => {
  delete process.env.CREW_API_URL; delete process.env.CREW_API_TOKEN;
  assert.equal(c.onboarded(), null); assert.equal(c.crewConn(), null);
  c.saveSetup(c.parseSetup({ ...ok, engine: { mode: "crew", url: "https://c.example", token: "tok" } })!);
  assert.equal(c.onboarded(), "done"); assert.equal(c.company()?.name, "Acme");
  assert.deepEqual(c.crewConn(), { url: "https://c.example", token: "tok" });
});
test("authEnv emits a verifiable scrypt hash", () => {
  const e = c.authEnv("password123");
  assert.match(e, /OS_AUTH=password\nOS_PASSWORD_HASH=scrypt:[0-9a-f]{32}:[0-9a-f]{64}\nOS_SESSION_SECRET=[0-9a-f]{64}/);
});

test("authEnv adds the 2FA secret only when given", async () => {
  const { authEnv } = await import("../lib/config.ts");
  assert.ok(!authEnv("longenough1").includes("OS_TOTP_SECRET"));
  assert.match(authEnv("longenough1", "ABCDEFGHIJKLMNOP"), /OS_TOTP_SECRET=ABCDEFGHIJKLMNOP/);
});

test("setup code gate accepts only the right code", async () => {
  process.env.OS_SETUP_TOKEN = "test-setup-code-123";
  const { setupOk } = c;
  assert.equal(setupOk("test-setup-code-123"), true);
  assert.equal(setupOk("nope"), false);
  assert.equal(setupOk(null), false);
});
