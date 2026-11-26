import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { validSlug, advisorDir, ensureIndex, advisorPrompt, advisorArgs } from "../lib/advisors.ts";
import { listPresets } from "../lib/config.ts";

for (const bad of ["", "..", "../x", "a/b", "a\\b", "A", "-a", "a-", "a..b", ".hidden", "a b", "x".repeat(60), "a\0b"]) assert.equal(validSlug(bad), false, bad);
for (const ok of ["a", "growth-advisor", "mentor2"]) assert.equal(validSlug(ok), true, ok);
assert.throws(() => advisorDir("../etc"));

const root = fs.mkdtempSync(path.join(os.tmpdir(), "adv-"));
const kb = path.join(root, "m", "kb");
fs.mkdirSync(kb, { recursive: true });
fs.writeFileSync(path.join(kb, "b.md"), "intro\n# Pricing\ntext");
fs.writeFileSync(path.join(kb, "a.txt"), "plain");
fs.writeFileSync(path.join(kb, "skip.png"), "x");
const idx = fs.readFileSync(ensureIndex("m", root), "utf8");
assert.ok(idx.includes("- a.txt\n") && idx.includes("- b.md — Pricing") && !idx.includes("skip.png"));
fs.writeFileSync(path.join(kb, "INDEX.md"), "custom");
ensureIndex("m", root);
assert.equal(fs.readFileSync(path.join(kb, "INDEX.md"), "utf8"), "custom", "existing INDEX.md is kept");

const p = advisorPrompt("m");
assert.match(p, /Never claim or imply to be a real person/);
assert.match(p, /kb\/INDEX\.md first/);
const a = advisorArgs("/srv/x/data/advisors/m", "q?");
const allowed = a[a.indexOf("--allowedTools") + 1];
assert.equal(allowed, "Read(//srv/x/data/advisors/m/**),Glob(//srv/x/data/advisors/m/**),Grep(//srv/x/data/advisors/m/**)", "tools scoped to the advisor folder");
assert.ok(!allowed.split(",").includes("Read"), "no unscoped Read");
assert.match(a[a.indexOf("--disallowedTools") + 1], /Bash.*Write.*WebFetch/);
assert.deepEqual(listPresets().filter((x) => x.startsWith("advisor-")), [], "template is not a persona preset");
fs.rmSync(root, { recursive: true });
console.log("advisors-test: ok");
