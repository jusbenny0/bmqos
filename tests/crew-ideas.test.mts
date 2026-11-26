import test from "node:test";
import assert from "node:assert/strict";
import { ideasHTML } from "../components/mod/ideas.ts";
import { SECS, where } from "../components/shell.ts";
import * as crew from "../lib/crew.ts";

test("Ideas section is in the shell and has a mount point", () => {
  assert.ok(SECS.some((s) => s.routes.includes("crew-ideas")));
  assert.match(where("crew-ideas"), /Ideas/);
  assert.match(ideasHTML(), /id="ideas-root"/);
});

test("demo mode: idea -> ready with synthesis, approve -> tasks", async () => {
  const i = await crew.createIdea("x");
  assert.equal(i.status, "ready");
  assert.ok(i.synthesis && i.synthesis.questions.length <= 3);
  assert.equal((await crew.approveIdea(i.id, [])).status, "approved");
});
