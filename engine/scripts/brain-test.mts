// Brain test: npx tsx scripts/brain-test.mts
import assert from "node:assert/strict";
import fs from "node:fs";
import { addDecision, getNode, search } from "../lib/brain";
const r = search("markdown");
assert.ok(r.length && r[0].id === "decisions/2026-11-19-brain-jako-markdown", JSON.stringify(r));
const n = getNode("projects/crew")!;
assert.deepEqual(n.links, ["decisions/2026-11-19-brain-jako-markdown"]);
assert.equal(getNode("../package"), null);
assert.equal(getNode("nic/neni"), null);
const d = addDecision("Test decision", "Test text [[projects/crew]]");
assert.deepEqual(d.links, ["projects/crew"]);
assert.equal(search("test")[0].id, d.id);
fs.unlinkSync(`brain/${d.id}.md`);
console.log("brain ok");
