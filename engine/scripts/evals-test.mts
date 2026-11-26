// Unit checks for the code judge (no LLM).
import assert from "node:assert/strict";
import { codeCheck, loadCases, evalRoles } from "../lib/evals.ts";
const c = { id: "x", input: "", expect: { last_line: "^VERDICT:\\s*RETURN$", must: ["email"], must_not: ["sk_live"] } };
assert.equal(codeCheck(c, "missing email check\nVERDICT: RETURN").pass, true);
assert.equal(codeCheck(c, "missing email check\nVERDICT: APPROVED").pass, false);
assert.equal(codeCheck(c, "VERDICT: RETURN").pass, false, "must");
assert.equal(codeCheck(c, "email sk_live_x\nVERDICT: RETURN").pass, false, "must_not");
for (const role of evalRoles()) for (const k of loadCases(role)) {
  assert.ok(k.id && k.input && (k.expect || k.judge), `${role}/${k.id} is a valid case`);
  for (const r of [k.expect?.last_line, ...(k.expect?.must ?? []), ...(k.expect?.must_not ?? [])]) if (r) new RegExp(r);
}
console.log("evals-test: ok");
