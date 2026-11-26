import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detect, plan, buildRoles, write, type Provider } from "../engine/lib/providers.ts";
import { DEFAULT_TEAM } from "../engine/lib/config.ts";

const tmp = mkdtempSync(join(tmpdir(), "prov-"));
const bin = join(tmp, "bin"), home = join(tmp, "home");
mkdirSync(bin); mkdirSync(join(home, ".claude"), { recursive: true });
const fake = (name: string, code = 0) => { const f = join(bin, name); writeFileSync(f, `#!/bin/sh\nexit ${code}\n`); chmodSync(f, 0o755); };
const noNet = (async () => { throw new Error("down"); }) as unknown as typeof fetch;
const by = (l: Provider[], id: string) => l.find((p) => p.id === id)!;

test("detect: CLIs via PATH, claude login via credentials file, claude auth status fallback", async () => {
  fake("claude", 1); fake("agy");
  let l = await detect({ env: { PATH: bin, HOME: home }, fetch: noNet });
  assert.equal(by(l, "claude").available, false); // on PATH, `auth status` exits 1, no credentials
  assert.equal(by(l, "agy").available, true);
  assert.equal(by(l, "codex").available, false);
  writeFileSync(join(home, ".claude", ".credentials.json"), "{}");
  l = await detect({ env: { PATH: bin, HOME: home }, fetch: noNet });
  assert.equal(by(l, "claude").available, true);
});

test("detect: API keys by existence only, value never leaks", async () => {
  const secret = "sk-SECRET-VALUE-123";
  const l = await detect({ env: { PATH: "", HOME: home, OPENAI_API_KEY: secret, GOOGLE_API_KEY: secret }, fetch: noNet });
  assert.equal(by(l, "openai-api").available, true);
  assert.equal(by(l, "gemini-api").available, true);
  assert.equal(by(l, "anthropic-api").available, false);
  assert.ok(!JSON.stringify(l).includes(secret));
});

test("detect: local servers return model names and only localhost is queried", async () => {
  const urls: string[] = [];
  const f = (async (u: string) => {
    urls.push(u);
    if (u.includes(":11434")) return Response.json({ models: [{ name: "llama3" }] });
    return new Response("no", { status: 500 });
  }) as unknown as typeof fetch;
  const l = await detect({ env: { PATH: "", HOME: home }, fetch: f });
  assert.equal(by(l, "ollama").detail, "llama3");
  assert.equal(by(l, "lmstudio").available, false);
  assert.ok(urls.every((u) => u.startsWith("http://127.0.0.1:")));
});

test("detect: a hanging fetch is cut off by the time budget", async () => {
  const hang = (() => new Promise(() => {})) as unknown as typeof fetch;
  const t = Date.now();
  const l = await detect({ env: { PATH: "", HOME: home }, fetch: hang, budgetMs: 200 });
  assert.ok(Date.now() - t < 1500);
  assert.equal(by(l, "ollama").available, false);
  assert.equal(by(l, "ollama").detail, "check timed out");
});

test("plan: claude > agy for junior; unsupported ones ignored; mock when nothing", () => {
  const p = (id: string, kind: Provider["kind"], available = true): Provider => ({ id, kind, available, detail: "" });
  const c = plan([p("claude", "cli-subscription"), p("agy", "cli-subscription"), p("openai-api", "api-key"), p("ollama", "local")]);
  assert.deepEqual(c, { planning: "claude", building: "claude", junior: "agy", checks: "claude" });
  assert.equal(plan([p("openai-api", "api-key"), p("ollama", "local")]).planning, "mock");
});

test("buildRoles + write: roles file and engine .env", () => {
  const roles = buildRoles(DEFAULT_TEAM, { planning: "claude", building: "claude", junior: "claude", checks: "mock" });
  assert.equal(roles.find((r) => r.role === "junior")!.engine, "claude");
  assert.equal(roles.find((r) => r.role === "junior")!.engine_model, undefined);
  assert.equal(roles.find((r) => r.role === "reviewer")!.engine, "mock");
  const dir = join(tmp, "engine");
  mkdirSync(dir); writeFileSync(join(dir, ".env"), "PORT=3800");
  const file = write(dir, roles);
  assert.equal(JSON.parse(readFileSync(file, "utf8")).length, DEFAULT_TEAM.length);
  assert.equal(readFileSync(join(dir, ".env"), "utf8"), "PORT=3800\nCREW_ROLES_FILE=data/roles.json\n");
  write(dir, roles); // idempotent
  assert.equal(readFileSync(join(dir, ".env"), "utf8").match(/CREW_ROLES_FILE/g)!.length, 1);
});
