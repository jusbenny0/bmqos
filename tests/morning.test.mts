import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.OS_DB = join(mkdtempSync(join(tmpdir(), "os-morning-")), "os.db");
const { build, tick, get, dismiss, dayOf, sinceOf } = await import("../lib/morning.ts");
const { whose } = await import("../lib/items.ts");
type Item = Parameters<typeof build>[0][number];

const it = (id: string, o: Partial<Item> = {}): Item => ({ id, source: "paperclip", owner: { kind: "you", name: "Owner" }, state: "na-mne", type: "smer", project: "Company", text: id, actions: [], href: "", at: "2026-11-16T04:00:00Z", ...o });
const praha = (h: number, m: number): Date => new Date(`2026-11-16T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00+01:00`);

test("sinceOf: yesterday 18:00 Prague", () => {
  assert.equal(sinceOf(praha(8, 30)), new Date("2026-11-15T18:00:00+01:00").getTime());
});
test("build: events since 18:00, older gone, Needs attention with resolution", () => {
  const since = sinceOf(praha(8, 30));
  const xs = [
    it("done", { state: "hotovo", owner: { kind: "agent", name: "E1" } }),
    it("old", { state: "hotovo", at: "2026-11-15T10:00:00Z" }),
    it("hori-ok", { type: "hori", state: "hotovo", owner: { kind: "hermes", name: "Assistant" } }),
    it("hori-no", { type: "hori" }),
  ];
  const m = build(xs, since, praha(8, 30), 1);
  assert.deepEqual(m.done, ["done", "hori-ok"]);
  assert.deepEqual(m.fire, [{ t: "hori-ok", solved: true }, { t: "hori-no", solved: false }]);
  assert.equal(m.waiting, 1);
  assert.equal(m.down, 1);
});
test("a card is not an Item: doesn't increase Needs you (owner's item count is unchanged)", async () => {
  const xs = [it("a"), it("b", { state: "hotovo" })];
  const naMne = (l: Item[]) => l.filter((i) => i.state === "na-mne" && i.owner.kind === "you").length;
  const before = naMne(xs);
  await tick(praha(9, 0), async () => xs, async () => 0);
  assert.equal(naMne(xs), before);
  assert.ok(get(dayOf(praha(9, 0))));
  assert.equal(typeof whose, "function");
});
test("once a day: nothing before 8:30, then once, a restart won't overwrite it, dismissal persists", async () => {
  const d = new Date("2026-11-17T07:00:00+01:00");
  assert.equal(await tick(d, async () => [], async () => 0), false);
  const at = new Date("2026-11-17T08:30:00+01:00");
  assert.equal(await tick(at, async () => [it("x", { at: "2026-11-17T05:00:00Z" })], async () => 0), true);
  assert.equal(await tick(new Date("2026-11-17T12:00:00+01:00"), async () => [], async () => 0), false);
  assert.equal(get("2026-11-17")?.card.waiting, 1);
  dismiss("2026-11-17");
  assert.equal(await tick(new Date("2026-11-17T20:00:00+01:00"), async () => [], async () => 0), false);
  assert.equal(get("2026-11-17")?.dismissed, true);
  assert.equal(await tick(new Date("2026-11-18T08:31:00+01:00"), async () => [], async () => 0), true);
});
