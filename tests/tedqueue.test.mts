import test from "node:test";
import assert from "node:assert/strict";
import { flushQueue, type Job } from "../lib/tedqueue.ts";

const jobs: Job[] = [{ id: "card:1", value: "0", label: "a" }, { id: "card:2", value: "1", label: "b" }];

test("flush: online drains the queue", async () => {
  const left = new Set(jobs.map((j) => j.id));
  await flushQueue(jobs, async () => true, () => true, (id) => left.delete(id));
  assert.equal(left.size, 0);
});

test("flush: an error keeps the job in the queue and stops", async () => {
  const left = new Set(jobs.map((j) => j.id));
  await flushQueue(jobs, async (j) => j.id !== "card:1", () => true, (id) => left.delete(id));
  assert.deepEqual([...left], ["card:1", "card:2"]);
});
