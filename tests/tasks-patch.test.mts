import test from "node:test";
import assert from "node:assert/strict";

const { validatePatch } = await import("../lib/tasks.ts");
const route = await import("../app/api/tasks/[id]/route.ts");

test("validatePatch: non-string field → error, not an exception", () => {
  assert.equal(validatePatch({ title: 5 } as never), "field must be text");
  assert.equal(validatePatch({ priority: {} } as never), "field must be text");
  assert.equal(validatePatch({ assigneeAgentId: ["x"] } as never), "field must be text");
});

test("validatePatch: a valid title passes", () => {
  assert.equal(validatePatch({ title: "New title" }), null);
});

test("PATCH /api/tasks/[id]: null body → 400, not 500", async () => {
  const req = new Request("http://x/api/tasks/ABC-1", { method: "PATCH", body: "null", headers: { "Content-Type": "application/json" } });
  const res = await route.PATCH(req, { params: Promise.resolve({ id: "ABC-1" }) });
  assert.equal(res.status, 400);
});
