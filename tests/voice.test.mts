import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "../lib/voice.ts";

test("parse: JSON from Haiku even with surrounding text", () => {
  const d = parse('Here: {"text":"Fix ABC-1111.","title":"Fix","description":"Goal: fix","project":"BMQOS","level":"S"}', "raw");
  assert.deepEqual(d, { text: "Fix ABC-1111.", title: "Fix", description: "Goal: fix", project: "BMQOS", level: "S" });
});
test("parse: broken output falls back to raw transcript, level M", () => {
  const d = parse("ne json", "fix the button");
  assert.equal(d.text, "fix the button"); assert.equal(d.title, "fix the button"); assert.equal(d.level, "M");
});
test("parse: invalid level → M", () => assert.equal(parse('{"level":"XL"}', "x").level, "M"));
