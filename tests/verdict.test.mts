import test from "node:test";
import assert from "node:assert/strict";
import { scoreOf, shotsOf, verdictOf } from "../lib/verdict";
import { judgeOf } from "../lib/merge";

test("verdict: NEPROJDE and ZMENY take precedence over PROJDE", () => {
  assert.equal(verdictOf("Judge: rejected, can't call it approved"), "neprojde");
  assert.equal(verdictOf("QA: changes requested"), "zmeny");
  assert.equal(verdictOf("Visual Critic: approved 8.1/10"), "projde");
  assert.equal(verdictOf("Code Reviewer: OK"), "projde");
  assert.equal(verdictOf("Security: blok"), "neprojde");
  assert.equal(verdictOf("code reviewer: changes requested"), "zmeny");
  assert.equal(verdictOf("no changes"), "neznamy");
  assert.equal(verdictOf("nothing"), "neznamy");
});
test("score and shots", () => {
  assert.equal(scoreOf("score 7.5/10"), 7.5);
  assert.deepEqual(shotsOf("shots-impl/a-1440.png and https://example.com/b.png"), ["https://example.com/b.png", "shots-impl/a-1440.png"]);
});
test("judge comment: English and Czech verdicts, negative wins", () => {
  process.env.OS_JUDGE_AGENT_ID = "j";
  const j = (body: string) => judgeOf([{ body, authorAgentId: "j" }]);
  assert.equal(j("VERDICT: APPROVED").ok, true);
  assert.equal(j("Judge: PASS").ok, true);
  assert.equal(j("PROJDE").ok, true);
  assert.equal(j("VERDICT: REJECTED - was APPROVED before").ok, false);
  assert.equal(j("NEPROJDE").ok, false);
  assert.equal(judgeOf([{ body: "APPROVED", authorAgentId: "someone" }]).text, "Judge hasn't decided yet");
});
