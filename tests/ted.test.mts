import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.OS_PROJECTS = JSON.stringify([{ n: "BMQOS", re: "bmqos" }]);
process.env.OS_DB = join(mkdtempSync(join(tmpdir(), "os-ted-")), "os.db");
const { stavOf, projectsOf } = await import("../lib/ted.ts");

test("stavOf: first 2 bullets of the ## Stav block without markdown", () => {
  const md = "# Hub\n\n## Stav (18. 11.)\n- **ABC-1** [link](/x) done\n- second line\n- third\n\n## Other\n- nothing";
  assert.equal(stavOf(md), "ABC-1 link done · second line");
  assert.equal(stavOf("# no block"), "");
});
test("projectsOf: done/remaining, who's running, last change", () => {
  const r = (o: object) => ({ identifier: "ABC-1", title: "BMQOS x", status: "in_progress", project: "BMQOS", agent: "E1", assigneeUser: false, waitsHuman: false, running: true, at: "2026-11-18T10:00:00Z", ask: null, q: null, more: 0, deferred: false, ...o });
  const p = projectsOf([r({}), r({ status: "done", running: false, at: "2026-11-18T11:00:00Z" }), r({ title: "other", project: "Firma" })], () => "status")[0];
  assert.deepEqual({ ...p }, { name: "BMQOS", stav: "status", open: 1, done: 1, running: ["E1"], updatedAt: "2026-11-18T11:00:00Z" });
});
