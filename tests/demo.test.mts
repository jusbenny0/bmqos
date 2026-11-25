import { test } from "node:test";
import assert from "node:assert/strict";
import { demoOn, demoSnapshot } from "../lib/demo.ts";

test("demo mode is on without PAPERCLIP_API_URL and off with it", () => {
  const prev = process.env.PAPERCLIP_API_URL, prevDemo = process.env.OS_DEMO;
  delete process.env.PAPERCLIP_API_URL; delete process.env.OS_DEMO;
  assert.equal(demoOn(), true);
  process.env.PAPERCLIP_API_URL = "http://backend";
  assert.equal(demoOn(), false);
  process.env.OS_DEMO = "1";
  assert.equal(demoOn(), true);
  delete process.env.PAPERCLIP_API_URL; process.env.OS_DEMO = "0";
  assert.equal(demoOn(), false);
  if (prev === undefined) delete process.env.PAPERCLIP_API_URL; else process.env.PAPERCLIP_API_URL = prev;
  if (prevDemo === undefined) delete process.env.OS_DEMO; else process.env.OS_DEMO = prevDemo;
});

test("demo snapshot has sample data for the main views", () => {
  const s = demoSnapshot();
  assert.ok(s.agents.length > 0 && s.wait.length > 0 && s.projects.length > 0 && s.days.length === 7);
});

test("demo services and machines are generic sample data", async () => {
  const { demoServices, demoMachines } = await import("../lib/demo.ts");
  assert.ok(demoServices().length > 0 && demoMachines().every((m) => m.m && m.name.startsWith("demo-")));
});
