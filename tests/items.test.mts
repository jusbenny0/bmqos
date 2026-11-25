import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.OS_DB = join(mkdtempSync(join(tmpdir(), "os-items-")), "os.db");
const { whose, filter, addMine, doneMine, snooze, items, applySnooze } = await import("../lib/items.ts");

const at = "2026-11-15T10:00:00Z";
const th = (title: string, o: Partial<Parameters<typeof whose>[0]> = {}) => whose({ title, status: "in_review", waitsHuman: true, assigneeUser: false, agent: "Engineer 2", at, ...o });

// real task shapes from Paperclip (anonymised titles)
test("review, QA, merge, test deploy waiting on \"a human\" → Hermes", () => {
  for (const [title, rule] of [
    ["BMQOS · E2 ABC-714: fixes after first use – PR #16 to merge", "merge into working branch"],
    ["BMQOS · Code Review layer 4 (PR #6)", "review"],
    ["BMQOS · QA: prod 1440+390, merged state", "QA"],
    ["BMQOS · CTO: Hermes deploys layer 5 preview", "test deploy"],
  ] as const) {
    const v = th(title);
    assert.equal(v.owner.kind, "hermes", title);
    assert.equal(v.state, "bezi");
    assert.equal(v.type, "agenti");
    assert.equal(v.decidedByHermes?.rule, rule, title);
  }
});

test("an open card for the owner = owner's; type from card content, default Direction", () => {
  const cases: [string, string, string][] = [
    ["Launch example.com: new site version", "", "verejne"],
    ["Payment", "Approve $1,200 payment for the domain", "penize"],
    ["Anything", "Need a new API key for Dokploy", "klic"],
    ["Production is down: site not working", "", "hori"],
    ["Video review: what to use", "Dropshipping: just the process, or a trial run?", "smer"], // ABC-112: title doesn't match anything → Direction
  ];
  for (const [title, ask, type] of cases) {
    const v = th(title, { ask });
    assert.equal(v.owner.kind, "you", title);
    assert.equal(v.state, "na-mne");
    assert.equal(v.type, type, title);
    assert.equal(v.decidedByHermes, undefined);
  }
});

test("a task assigned to a user is always the owner's", () => {
  const v = th("Check the test deploy", { status: "todo", waitsHuman: false, assigneeUser: true });
  assert.deepEqual([v.owner.kind, v.state, v.type], ["you", "na-mne", "smer"]);
  assert.equal(th("Pay the hosting invoice", { status: "todo", waitsHuman: false, assigneeUser: true }).type, "penize");
});

test("waiting with no card and no Hermes rule → Hermes with a marked rule, not the owner", () => {
  const v = th("Video review: what to use");
  assert.deepEqual([v.owner.kind, v.decidedByHermes?.rule], ["hermes", "no question for the owner"]);
});

// real-world task shapes (anonymised): title + open card text
const REAL: [string, string, string, Partial<Parameters<typeof whose>[0]>, string, string][] = [
  ["ABC-112", "Video review: what to use, what we already have, new business", "Videos: positioning and pilot (4 questions) Dropshipping: just the process?", {}, "na-mne", "smer"],
  ["ABC-473", "Social proposals 2026-11-13", "Social proposals 2026-11-13", {}, "na-mne", "obsah"],
  ["ABC-272", "Website: build on live example.com – opening ≤3 s", "Website launch: PR #23 – confirm release", {}, "na-mne", "verejne"],
  ["ABC-110", "Google Ads + Meta Ads for Acme: campaign proposal", "Ads: approve campaign budget", {}, "na-mne", "penize"],
  ["ABC-108", "Outreach engine: take over the plan", "Outreach: decision before merge", { deferred: true }, "odlozeno", "smer"],
];
test("real data: owner's cards are Needs You, deferred ones are Snoozed", () => {
  for (const [id, title, ask, o, state, type] of REAL) {
    const v = th(title, { ask, ...o });
    assert.deepEqual([id, v.owner.kind, v.state, v.type], [id, "you", state, type]);
  }
});
test("real data: ABC-594 assigned to Hermes, no card → not Needs You", () => {
  const v = th("Docs Site · E1: login UX implementation", { status: "in_progress", waitsHuman: false, agent: "Hermes", ask: null });
  assert.deepEqual([v.owner.kind, v.state], ["hermes", "bezi"]);
});

// askOf over a network mock under `get` (fetch): pending card = ask; "not yet" after the card = deferred; API error = stays with the owner
test("askOf: card = ask, \"not yet\" after the card = deferred, API error = task stays with the owner", async () => {
  const { askOf } = await import("../lib/paperclip.ts");
  const realFetch = globalThis.fetch, realWarn = console.warn;
  const realUrl = process.env.PAPERCLIP_API_URL;
  process.env.PAPERCLIP_API_URL = "http://paperclip.test/api";
  const card = { kind: "ask_user_questions", status: "pending", title: "Approve deploy", createdAt: "2026-11-15T10:00:00Z", payload: { questions: [{ prompt: "Ship it?" }] } };
  const comment = (body: string) => [{ authorType: "user", body, createdAt: "2026-11-15T11:00:00Z" }];
  let routes: Record<string, () => Response> = {};
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    const hit = Object.keys(routes).find((k) => url.includes(k));
    return hit ? routes[hit]() : Response.json([]);
  }) as typeof fetch;
  let warned = 0;
  console.warn = () => { warned++; };
  try {
    routes = { "/interactions": () => Response.json([card]), "/comments": () => Response.json([]) };
    const pending = await askOf("ABC-9001");
    assert.ok(pending.ask?.includes("Approve"));
    assert.equal(pending.deferred, false);

    routes = { "/interactions": () => Response.json([card]), "/comments": () => Response.json(comment("not yet, after the release")) };
    assert.equal((await askOf("ABC-9002")).deferred, true);

    // narrower regex: a generic "later" no longer defers
    routes = { "/interactions": () => Response.json([card]), "/comments": () => Response.json(comment("handling it later")) };
    assert.equal((await askOf("ABC-9003")).deferred, false);

    routes = { "/interactions": () => new Response("boom", { status: 500 }), "/comments": () => Response.json([]) };
    const down = await askOf("ABC-9004");
    assert.ok(down.ask && down.ask !== "", "an API error must not return \"no card\"");
    assert.equal(down.deferred, false);
    assert.equal(warned, 1);
  } finally {
    globalThis.fetch = realFetch;
    console.warn = realWarn;
    if (realUrl === undefined) delete process.env.PAPERCLIP_API_URL; else process.env.PAPERCLIP_API_URL = realUrl;
  }
});

test("agent running work, done", () => {
  const run = whose({ title: "Launch to production", status: "in_progress", waitsHuman: false, assigneeUser: false, agent: "CTO", at });
  assert.deepEqual([run.owner, run.state, run.type], [{ kind: "agent", name: "CTO" }, "bezi", "agenti"]); // agent is working, owner isn't up next
  const done = whose({ title: "x", status: "done", waitsHuman: false, assigneeUser: false, agent: "Hermes", at });
  assert.deepEqual([done.owner.kind, done.state], ["hermes", "hotovo"]);
});

test("tabs and filters", async () => {
  const id = addMine("Call the accountant");
  const all = await items();
  const mine = all.find((i) => i.id === `mine:${id}`)!;
  assert.equal(mine.state, "na-mne");
  assert.equal(filter(all, { tab: "na-mne", type: "moje" }).length, 1);
  assert.equal(filter(all, { q: "accountant" }).length, 1); // without diacritics
  assert.equal(filter(all, { project: "Nic" }).length, 0);
});

test("snoozing works for any Item.id and reverts once the date has passed", async () => {
  const id = addMine("Task to snooze");
  snooze(`mine:${id}`, Date.now() + 86_400_000);
  assert.equal((await items()).find((i) => i.id === `mine:${id}`)?.state, "odlozeno");
  snooze(`mine:${id}`, Date.now() - 1000); // already elapsed
  assert.equal((await items()).find((i) => i.id === `mine:${id}`)?.state, "na-mne");
  snooze("paperclip:ABC-1", Date.now() + 1000); // foreign id: write succeeds, nothing throws
  assert.ok(doneMine(id));
  snooze(`mine:${id}`, Date.now() + 86_400_000);
  assert.equal((await items()).find((i) => i.id === `mine:${id}`)?.state, "hotovo"); // done items don't get snoozed
});

test("nothing breaks without env sources", async () => {
  delete process.env.PAPERCLIP_API_URL; delete process.env.SOCIAL_API_URL;
  assert.ok(Array.isArray(await items()));
});

test("false regex matches – Release Manager, pick, tokenizer are not owner's types", () => {
  for (const title of ["BMQOS · Release Manager: summary for the owner", "Pick a reviewer for PR #19", "Tokenizer: fix tests"]) {
    assert.equal(th(title).owner.kind, "hermes", title);
  }
});

test("a task assigned to Hermes isn't Needs You, even if the title sounds like the owner's type", () => {
  const v = th("Renew API key for Dokploy", { agent: "Hermes" });
  assert.equal(v.owner.kind, "hermes");
  assert.equal(v.state, "bezi");
  assert.equal(v.type, "agenti");
  // assigned to the owner stays the owner's
  assert.equal(th("Renew API key for Dokploy", { agent: "Hermes", assigneeUser: true }).state, "na-mne");
});

test("a deferred item from Paperclip belongs in Snoozed, back once it elapses", () => {
  const v = whose({ title: "Approve $1,200 payment", status: "in_review", waitsHuman: true, assigneeUser: false, agent: "CTO", at, ask: "Approve payment" });
  const item = { id: "paperclip:ABC-108", source: "paperclip", ...v, project: "Firma", text: "x", actions: [], href: "", at } as Parameters<typeof applySnooze>[0][number];
  assert.equal(item.state, "na-mne");
  const now = Date.now();
  assert.equal(applySnooze([item], new Map([["paperclip:ABC-108", now + 1e6]]), now)[0].state, "odlozeno");
  assert.equal(applySnooze([item], new Map([["paperclip:ABC-108", now - 1]]), now)[0].state, "na-mne");
});
