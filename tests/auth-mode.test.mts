import test from "node:test";
import assert from "node:assert/strict";
import { authOff } from "../lib/session.ts";

test("auth mode: no login by default, password when a hash or OS_AUTH=password is set", () => {
  const keep = { a: process.env.OS_AUTH, h: process.env.OS_PASSWORD_HASH };
  delete process.env.OS_AUTH; delete process.env.OS_PASSWORD_HASH;
  assert.equal(authOff(), true);
  process.env.OS_PASSWORD_HASH = "scrypt:00:00";
  assert.equal(authOff(), false);
  process.env.OS_AUTH = "none";
  assert.equal(authOff(), true);
  delete process.env.OS_PASSWORD_HASH; process.env.OS_AUTH = "password";
  assert.equal(authOff(), false);
  if (keep.a === undefined) delete process.env.OS_AUTH; else process.env.OS_AUTH = keep.a;
  if (keep.h === undefined) delete process.env.OS_PASSWORD_HASH; else process.env.OS_PASSWORD_HASH = keep.h;
});
