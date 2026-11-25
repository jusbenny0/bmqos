import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.OS_DB = join(mkdtempSync(join(tmpdir(), "os-cards-")), "os.db");
process.env.OS_CARDS_KEY = "k".repeat(32);
const { isLan, fromLan, keyOk, parseNew, answer, card, cards, answered } = await import("../lib/cards.ts");
const route = await import("../app/api/cards/route.ts");
const one = await import("../app/api/cards/[id]/route.ts");

const hdr = (o: Record<string, string> = {}) => ({ "x-forwarded-for": "192.168.1.70", authorization: `Bearer ${"k".repeat(32)}`, "content-type": "application/json", ...o });
const body = { text: "Release the client site to production?", type: "verejne", project: "Client", options: ["Release", "Wait"] };
const post = (headers: Record<string, string>, b: unknown = body) => route.POST(new Request("http://os/api/cards", { method: "POST", headers, body: JSON.stringify(b) }));

test("LAN: private addresses yes, public and Cloudflare no", () => {
  for (const ip of ["10.1.2.3", "172.16.0.1", "172.31.9.9", "192.168.1.70", "127.0.0.1", "::1", "::ffff:192.168.1.5", "fd12::1"]) assert.ok(isLan(ip), ip);
  for (const ip of ["8.8.8.8", "172.32.0.1", "1.1.1.1", "", "?", "2001:db8::1"]) assert.ok(!isLan(ip), ip);
  assert.ok(!fromLan(new Request("http://os", { headers: { "x-forwarded-for": "192.168.1.5", "cf-connecting-ip": "8.8.8.8" } })));
  assert.ok(!fromLan(new Request("http://os"))); // no proxy header = unknown = no
  assert.ok(!fromLan(new Request("http://os", { headers: { "x-forwarded-for": "192.168.1.5, 8.8.8.8" } }))); // the proxy appended the last entry
});

test("POST /api/cards: rejected without a key, with a wrong key, and outside the LAN", async () => {
  assert.equal((await post(hdr({ authorization: "" }))).status, 401);
  assert.equal((await post(hdr({ authorization: "Bearer wrong" }))).status, 401);
  assert.equal((await post(hdr({ authorization: `Bearer ${"x".repeat(32)}` }))).status, 401);
  assert.equal((await post(hdr({ "x-forwarded-for": "8.8.8.8" }))).status, 403); // correct key, but outside the LAN
  assert.equal((await post(hdr({ "cf-connecting-ip": "8.8.8.8" }))).status, 403);
  assert.equal(cards().length, 0);
  const prev = process.env.OS_CARDS_KEY; delete process.env.OS_CARDS_KEY; // key not set = closed
  assert.equal((await post(hdr({ authorization: "Bearer " }))).status, 401);
  process.env.OS_CARDS_KEY = prev;
  assert.ok(!keyOk(new Request("http://os")));
});

test("POST /api/cards: validation and creation", async () => {
  for (const b of [{ ...body, type: "moje" }, { ...body, options: [] }, { ...body, options: ["a", "b", "c", "d"] }, { ...body, text: "" }, { ...body, project: "" }, null])
    assert.equal((await post(hdr(), b)).status, 400, JSON.stringify(b));
  assert.equal(parseNew({ ...body, options: ["a", 1] }), null);
  const r = await post(hdr());
  assert.equal(r.status, 201);
  assert.equal(card(((await r.json()) as { id: number }).id)?.type, "verejne");
});

test("answer: once, choice within range, GET ?answered=1 only with a key", async () => {
  const id = cards()[0].id;
  const get = (h: Record<string, string>, q = "?answered=1") => route.GET(new Request(`http://os/api/cards${q}`, { headers: h }));
  assert.equal((await get({ "x-forwarded-for": "192.168.1.70" })).status, 401);
  assert.deepEqual(await (await get(hdr())).json(), []); // nobody has answered yet
  assert.equal((await get(hdr(), "")).status, 400);
  assert.ok(!answer(id, 3)); // out of range
  assert.ok(!answer(id, 0));
  assert.ok(answer(id, 2));
  assert.ok(!answer(id, 1)); // not a second time
  const out = (await (await get(hdr())).json()) as { id: number; choice: number; label: string }[];
  assert.deepEqual(out.map((x) => [x.id, x.choice, x.label]), [[id, 2, "Wait"]]);
  assert.equal(answered(id).length, 0);
});

test("POST /api/cards/[id] without a session is rejected (audit denied) and writes nothing", async () => {
  const id = ((await (await post(hdr())).json()) as { id: number }).id;
  const r = await one.POST(new Request(`http://os/api/cards/${id}`, { method: "POST", headers: { origin: "http://os", host: "os" }, body: JSON.stringify({ choice: 1 }) }), { params: Promise.resolve({ id: String(id) }) });
  assert.equal(r.status, 403);
  assert.equal(card(id)?.choice, null);
  const bad = await one.POST(new Request("http://os/api/cards/999", { method: "POST", body: "{}" }), { params: Promise.resolve({ id: "999" }) });
  assert.equal(bad.status, 404);
});

test("card type is raised by sensitive words, never lowered", () => {
  const p = (text: string, type: string) => parseNew({ ...body, text, type })?.type;
  assert.equal(p("Pay the 5,000 USD invoice?", "smer"), "penize");
  assert.equal(p("New API key for Dokploy?", "hori"), "klic");
  assert.equal(p("Publikovat web na ostro?", "obsah"), "verejne");
  assert.equal(p("Kterou variantu loga?", "smer"), "smer");
  assert.equal(p("Zaplatit fakturu?", "klic"), "klic");
});

test("keyOk with a non-ASCII header doesn't throw; large body 413", async () => {
  assert.equal(keyOk(new Request("http://os", { headers: { authorization: `Bearer ${"é".repeat(16)}` } })), false);
  assert.equal((await post(hdr({ "content-length": "5000" }))).status, 413);
});
