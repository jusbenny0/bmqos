// Unit checks for the self-improvement loop and evidence routes (no LLM, no network).
import assert from "node:assert/strict";
import { parseRetro, addLesson } from "../lib/retro.ts";
import { routesFromFiles } from "../lib/evidence.ts";

assert.deepEqual(parseRetro("work done\nRETRO: missing: preview URL in the brief; learned: run tsc before the build\nVERDICT: APPROVED"),
  { gap: "preview URL in the brief", lesson: "run tsc before the build" });
assert.deepEqual(parseRetro("RETRO: missing: -; learned: -"), { gap: "-", lesson: "-" });
assert.equal(parseRetro("no retro line"), null);

let p = "You are a builder.";
for (let i = 1; i <= 14; i++) p = addLesson(p, `rule ${i}`);
assert.ok(p.startsWith("You are a builder."));
assert.equal((p.match(/^- rule/gm) ?? []).length, 12, "keeps only the newest 12 lessons");
assert.ok(!p.includes("- rule 1\n") && p.endsWith("- rule 14"));
assert.equal(addLesson(p, "rule 14").match(/- rule 14/g)?.length, 1, "no duplicate lessons");

assert.deepEqual(routesFromFiles(["app/(site)/pricing/page.tsx", "app/blog/[slug]/page.tsx", "src/app/page.tsx", "lib/x.ts"]), ["/", "/pricing"]);
console.log("retro-test: ok");
