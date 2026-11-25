import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { runSetup } from "../scripts/setup.mjs";

const TMP = mkdtempSync(join(tmpdir(), "bmqos-setup-"));
const TEST_DB_1 = TMP + "/test-setup-local.db";
const TEST_DB_2 = TMP + "/test-setup-server.db";
const TEST_DB_3 = TMP + "/test-setup-public.db";
const ENV_FILE = join(TMP, ".env");
process.env.BMQOS_ENV_FILE = ENV_FILE; // never touch the real <repo>/.env

test("setup: local mode without authentication (default safe localhost)", async () => {
  const result = await runSetup({
    interactive: false,
    mode: "local",
    auth: "none",
    company: "Acme AI Corp",
    owner: "Alice",
    dbPath: TEST_DB_1,
    port: "3000",
    host: "",
    origin: "",
    user: "admin",
    password: "",
    crewUrl: "",
    crewToken: "",
  });

  assert.equal(result.mode, "local");
  assert.equal(result.auth, "none");
  assert.equal(result.host, "127.0.0.1");
  assert.equal(result.port, "3000");
  assert.equal(result.isOpenPublic, false);

  // Verify SQLite database schema matches Onboarding specification (Task #8 / #23)
  assert.ok(existsSync(TEST_DB_1));
  const db = new DatabaseSync(TEST_DB_1);
  const rows = db.prepare("SELECT key, value FROM config").all() as { key: string; value: string }[];
  const config = Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]));
  db.close();

  // Onboarding parities:
  assert.equal(config.company.name, "Acme AI Corp");
  assert.equal(config.company.accent, "#059669");
  assert.equal(config.company.owner, "Alice");
  assert.equal(config.onboarded, "done");

  assert.ok(Array.isArray(config.agents));
  assert.equal(config.agents.length, 4);
  assert.deepEqual(
    config.agents.map((a: { name: string }) => a.name),
    ["Planner", "Builder", "Reviewer", "Assistant"]
  );

  assert.equal(config.engine.mode, "demo");
  assert.equal(config.goal.model, "sonnet");
  assert.equal(config.goal.limit, 0);

  // Verify .env file content
  const envContent = readFileSync(ENV_FILE, "utf8");
  assert.match(envContent, /^OS_AUTH=$/m);
  assert.match(envContent, /^OS_PASSWORD_HASH=$/m);
  assert.match(envContent, /^HOSTNAME=127\.0\.0\.1$/m);
  assert.match(envContent, /^PORT=3000$/m);
  assert.match(envContent, /^OS_SESSION_SECRET=[0-9a-f]{64}$/m);

  rmSync(TEST_DB_1, { force: true });
});

test("setup: server mode defaults to safe 127.0.0.1 for reverse proxy", async () => {
  const result = await runSetup({
    interactive: false,
    mode: "server",
    auth: "password",
    password: "SuperSecretPassword123!",
    user: "sysadmin",
    company: "Cloud Agents Ltd",
    owner: "Bob",
    dbPath: TEST_DB_2,
    port: "8080",
    host: "", // left blank -> must default to 127.0.0.1 for safety behind reverse proxy
    origin: "https://bmqos.example.com",
    crewUrl: "https://crew.example.com",
    crewToken: "secret-token",
  });

  assert.equal(result.mode, "server");
  assert.equal(result.auth, "password");
  assert.equal(result.host, "127.0.0.1");
  assert.equal(result.port, "8080");
  assert.equal(result.user, "sysadmin");
  assert.equal(result.isOpenPublic, false);

  // Verify SQLite database
  assert.ok(existsSync(TEST_DB_2));
  const db = new DatabaseSync(TEST_DB_2);
  const rows = db.prepare("SELECT key, value FROM config").all() as { key: string; value: string }[];
  const config = Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]));
  db.close();

  assert.equal(config.company.name, "Cloud Agents Ltd");
  assert.equal(config.company.owner, "Bob");
  assert.equal(config.onboarded, "done");
  assert.equal(config.engine.mode, "crew");
  assert.equal(config.engine.url, "https://crew.example.com");

  // Verify .env file content
  const envContent = readFileSync(ENV_FILE, "utf8");
  assert.match(envContent, /^OS_AUTH=password$/m);
  assert.match(envContent, /^OS_USER=sysadmin$/m);
  assert.match(envContent, /^OS_PASSWORD_HASH=scrypt:[0-9a-f]{32}:[0-9a-f]{64}$/m);
  assert.match(envContent, /^HOSTNAME=127\.0\.0\.1$/m);
  assert.match(envContent, /^PORT=8080$/m);
  assert.match(envContent, /^OS_ORIGIN=https:\/\/bmqos\.example\.com$/m);
  assert.match(envContent, /^CREW_API_URL=https:\/\/crew\.example\.com$/m);
  assert.match(envContent, /^CREW_API_TOKEN=secret-token$/m);

  rmSync(TEST_DB_2, { force: true });
});

test("setup: detects open public 0.0.0.0 without authentication", async () => {
  const result = await runSetup({
    interactive: false,
    mode: "server",
    auth: "none",
    host: "0.0.0.0",
    port: "3000",
    dbPath: TEST_DB_3,
    company: "Public Exposure Corp",
    owner: "Admin",
  });

  assert.equal(result.host, "0.0.0.0");
  assert.equal(result.auth, "none");
  assert.equal(result.isOpenPublic, true);

  rmSync(TEST_DB_3, { force: true });
});

test("setup: auto-generates password if auth=password but password omitted", async () => {
  const result = await runSetup({
    interactive: false,
    mode: "local",
    auth: "password",
    password: "",
    user: "admin",
    company: "Test Corp",
    owner: "Admin",
    dbPath: TEST_DB_1,
    port: "3000",
    host: "127.0.0.1",
    origin: "",
    crewUrl: "",
    crewToken: "",
  });

  assert.ok(result.generatedPassword && result.generatedPassword.length >= 12);
  const envContent = readFileSync(ENV_FILE, "utf8");
  assert.match(envContent, /^OS_AUTH=password$/m);
  assert.match(envContent, /^OS_PASSWORD_HASH=scrypt:[0-9a-f]{32}:[0-9a-f]{64}$/m);

  rmSync(TEST_DB_1, { force: true });
});
