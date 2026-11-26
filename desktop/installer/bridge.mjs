#!/usr/bin/env node
// Thin node bridge for the installer: reuses scripts/setup.mjs and engine/lib (no logic duplicated in Rust).
//   node bridge.mjs detect            -> JSON {providers, plan, groups, personas, playbooks}
//   node bridge.mjs apply '<json>'    -> writes engine roles; json = {choice?, personas?, playbook?}
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const [cmd, arg] = process.argv.slice(2);

if (cmd === "detect") {
  const P = await import(resolve(root, "engine/lib/providers.ts"));
  const { listPresets } = await import(resolve(root, "engine/lib/config.ts"));
  const { listPlaybooks } = await import(resolve(root, "engine/lib/playbooks.ts"));
  const providers = await P.detect();
  console.log(JSON.stringify({
    providers: providers.map((p) => ({ ...p, supported: P.isSupported(p) })),
    plan: P.plan(providers),
    groups: Object.keys(P.GROUPS),
    personas: listPresets(),
    playbooks: listPlaybooks(),
  }));
} else if (cmd === "apply") {
  const { runProviderSetup } = await import(resolve(root, "scripts/setup.mjs"));
  await runProviderSetup({ interactive: false, selection: JSON.parse(arg || "{}") });
} else {
  console.error("usage: bridge.mjs detect | apply <json>");
  process.exit(2);
}
