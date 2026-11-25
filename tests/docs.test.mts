import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = mkdtempSync(join(tmpdir(), "os-docs-"));
const root = join(tmp, "root");
mkdirSync(root);
writeFileSync(join(root, "a.md"), "# Hello\ntext");
writeFileSync(join(root, "s.md"), "# S\ntoken: abcdefghijklmnop");
writeFileSync(join(tmp, "outside.md"), "# outside");
symlinkSync(join(tmp, "outside.md"), join(root, "link.md"));
process.env.OS_DB = join(tmp, "t.db");
process.env.OS_DOC_ROOTS = `t|${root}`;
process.env.OS_DOCS_WRITE = "1";

const docs = await import("../lib/docs");
const { scrub } = await import("../lib/inbox");

test("scrub hides tokens and passwords", () => {
  assert.equal(scrub("Bearer abcdefghijklmnop1"), "Bearer [hidden]");
  assert.match(scrub("password: hunter2"), /\[hidden\]/);
  assert.equal(scrub("plain text"), "plain text");
});

test("fileOf: .., symlink pointing outside, .env, wrong extension, unknown root", () => {
  assert.ok(docs.fileOf("t:a.md"));
  assert.equal(docs.fileOf("t:../outside.md"), null);
  assert.equal(docs.fileOf("t:link.md"), null);
  assert.equal(docs.fileOf("t:.env.md"), null);
  assert.equal(docs.fileOf("t:a.sh"), null);
  assert.equal(docs.fileOf("x:a.md"), null);
});

test("fts: query sanitization", () => {
  assert.equal(docs.fts('hello "world" OR *'), '"hello"* "world"* "OR"*');
  assert.equal(docs.fts('"*()'), "");
});

test("saveDoc: saves with a version, rejects secrets and files outside the root", async () => {
  await docs.reindexNow();
  docs.saveDoc("t:a.md", "# New\ncontent");
  assert.equal(readFileSync(join(root, "a.md"), "utf8"), "# New\ncontent");
  assert.equal(docs.readDoc("t:a.md")?.versions.length, 1);
  assert.throws(() => docs.saveDoc("t:a.md", "token: abcdefghijklmnop"), /token/);
  assert.throws(() => docs.saveDoc("t:s.md", "# nothing"), /secrets/);
  assert.throws(() => docs.saveDoc("t:link.md", "x"), /cannot be edited/);
  assert.equal(docs.readDoc("t:s.md")?.editable, false);
});

test("reindexNow: a second call right after the first is rejected", async () => {
  await assert.rejects(docs.reindexNow(), /fresh/);
});

test("saveDoc: only indexed and allowed documents (not CLAUDE.md, AGENTS.md, .claude, requirements.txt, unindexed)", async () => {
  mkdirSync(join(root, ".claude"), { recursive: true });
  writeFileSync(join(root, "CLAUDE.md"), "# instructions");
  writeFileSync(join(root, "AGENTS.md"), "# agents");
  writeFileSync(join(root, "requirements.txt"), "flask");
  writeFileSync(join(root, ".claude", "x.md"), "# hidden");
  writeFileSync(join(root, "nova.md"), "# new, not indexed yet");
  await docs.reindex();
  writeFileSync(join(root, "pozdeji.md"), "# added after indexing");
  for (const id of ["t:CLAUDE.md", "t:AGENTS.md", "t:requirements.txt", "t:.claude/x.md", "t:pozdeji.md"])
    assert.throws(() => docs.saveDoc(id, "# changed"), /cannot be edited/, id);
  docs.saveDoc("t:nova.md", "# updated");
  assert.equal(readFileSync(join(root, "nova.md"), "utf8"), "# updated");
});
