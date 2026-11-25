import { test } from "node:test";
import assert from "node:assert/strict";
import { sendsOnEnter } from "../lib/chatkey.ts";

const k = { key: "Enter", shiftKey: false, isComposing: false };
test("Enter in chat with a mouse sends", () => assert.equal(sendsOnEnter(k, true, true), true));
test("Shift+Enter gives a new line", () => assert.equal(sendsOnEnter({ ...k, shiftKey: true }, true, true), false));
test("Enter on touch doesn't send", () => assert.equal(sendsOnEnter(k, true, false), false));
test("IME composing doesn't send", () => assert.equal(sendsOnEnter({ ...k, isComposing: true }, true, true), false));
test("outside chat doesn't send", () => assert.equal(sendsOnEnter(k, false, true), false));
test("a different key doesn't send", () => assert.equal(sendsOnEnter({ ...k, key: "a" }, true, true), false));
