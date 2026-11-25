import { test } from "node:test";
import assert from "node:assert/strict";
import { linkIssues, parseSse, splitActions, toAction } from "../lib/chatparse.ts";

test("SSE: events, unfinished remainder and bad JSON", () => {
  const p = parseSse('data: {"delta":"a"}\n\ndata: {oops}\n\ndata: {"tool":{"name":"x","state":"run"}}\n\ndata: {"done"');
  assert.deepEqual(p.events, [{ delta: "a" }, { tool: { name: "x", state: "run" } }]);
  assert.equal(p.rest, 'data: {"done"');
});
test("SSE: approval and done", () => {
  const p = parseSse('data: {"approval":{"run":"r1","title":"rm","choices":["once","deny"]}}\n\ndata: {"done":true}\n\n');
  assert.equal(p.events[0].approval?.run, "r1");
  assert.equal(p.events[1].done, true);
});
test("bmqos block → card, surrounding text stays", () => {
  const s = splitActions('Done.\n```bmqos\n{"do":"approve","id":"ABC-887"}\n```\nNext?');
  assert.deepEqual(s.map((x) => x.t), ["text", "act", "text"]);
  assert.equal(s[1].t === "act" && s[1].a.id, "ABC-887");
});
test("allowlist and id: unknown actions and bad ids stay text", () => {
  assert.equal(toAction('{"do":"delete","id":"ABC-1"}'), null);
  assert.equal(toAction('{"do":"approve","id":"ABC-1; rm"}'), null);
  assert.equal(toAction('{"do":"approve","id":"../x"}'), null);
  assert.equal(toAction('{"do":"answer","id":"ABC-1"}'), null); // missing text
  assert.equal(toAction("nejson"), null);
  assert.equal(toAction("null"), null);
  assert.equal(splitActions('```bmqos\n{"do":"delete","id":"ABC-1"}\n```').every((x) => x.t === "text"), true);
});
test("create doesn't need an id, but needs text", () => {
  assert.equal(toAction('{"do":"create","text":"Fix login"}')?.text, "Fix login");
  assert.equal(toAction('{"do":"create"}'), null);
});
test("unfinished block during streaming stays text", () => {
  assert.equal(splitActions('```bmqos\n{"do":"open","id":"ABC-1"').every((x) => x.t === "text"), true);
});
test("ABC-123 → link, tags and code left alone", () => {
  const h = linkIssues('<p>see ABC-12 and <a href="/x">ABC-5</a> <code>ABC-7</code> <span title="ABC-9">x</span></p>');
  assert.equal((h.match(/data-issue/g) ?? []).length, 1);
  assert.ok(h.includes('data-issue="ABC-12"'));
  assert.ok(h.includes('title="ABC-9"'));
});

test("create: title required, missing = first line of text, max 80", () => {
  assert.equal(toAction('{"do":"create","title":"Login","text":"Fix login\\nmore"}')?.title, "Login");
  assert.equal(toAction('{"do":"create","text":"Fix login\\nmore"}')?.title, "Fix login");
  assert.equal(toAction(JSON.stringify({ do: "create", title: "x".repeat(200), text: "t" }))?.title?.length, 80);
});
test("comment: id and text required", () => {
  assert.equal(toAction('{"do":"comment","id":"ABC-5","text":"Hi"}')?.text, "Hi");
  assert.equal(toAction('{"do":"comment","id":"ABC-5"}'), null);
  assert.equal(toAction('{"do":"comment","id":"x","text":"a"}'), null);
});
test("update: id + at least one change", () => {
  assert.equal(toAction('{"do":"update","id":"ABC-5","priority":"high"}')?.priority, "high");
  assert.equal(toAction('{"do":"update","id":"ABC-5","agent":"CTO","title":"New"}')?.title, "New");
  assert.equal(toAction('{"do":"update","id":"ABC-5"}'), null);
  assert.equal(toAction('{"do":"update","id":"../x","title":"a"}'), null);
});
