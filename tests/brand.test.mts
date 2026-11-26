import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "brand-test-"));
process.env.OS_DB = path.join(tmp, "os.db");
process.env.OS_BRAND_DIR = path.join(tmp, "brand");
process.env.BRAND_MOCK = "1";
const kitlib = await import("../lib/brandkit.ts");
const { zip } = await import("../lib/zip.ts");
const brand = await import("../lib/brand.ts");
const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#e0531f"/></svg>`);

test("kit validation: hex, lengths, paths", () => {
  assert.equal(kitlib.validateKit({ colors: { accent: "#aabbcc" } }).colors.accent, "#aabbcc");
  assert.throws(() => kitlib.validateKit({ colors: { accent: "red" } }), /hex/);
  assert.throws(() => kitlib.validateKit({ logo: { primary: "../x.svg" } }), /invalid path/);
  assert.throws(() => kitlib.validateKit({ voice: { tags: ["a", "b", "c", "d"] } }), /up to 3/);
  assert.throws(() => kitlib.validateBrief("post", { headline: "x".repeat(61) }), /max 60/);
  assert.throws(() => kitlib.validateBrief("og", { headline: "ok", cta: "go" }), /no CTA/);
});

test("HTML check: script, on*, iframe, external URLs; SVG namespace is fine", () => {
  const bad = ["<script>1</script>", `<div onclick="x()">`, "<iframe src=a>", `<img src="https://a.b/c.png">`, `<div style="background:url(//a.b/c)">`, "<style>@import 'a'</style>", "<link rel=stylesheet href=a>", `<a href="javascript:1">`];
  for (const h of bad) assert.ok(kitlib.htmlViolation(h), h);
  assert.equal(kitlib.htmlViolation(svg.toString()), null);
  assert.equal(kitlib.htmlViolation(`<img src="data:image/png;base64,AAAA"><p data-slot="headline">on time, on air</p>`), null);
});

test("path traversal is rejected", () => {
  assert.throws(() => brand.safePath(tmp, "..", "etc"), /outside/);
  assert.throws(() => brand.safePath(tmp, "/etc/passwd"), /outside/);
  assert.ok(brand.safePath(tmp, "a", "b.png").startsWith(tmp));
});

test("contrast ratio and grades", () => {
  assert.ok(Math.abs(kitlib.contrast("#000000", "#ffffff") - 21) < 0.01);
  const r = kitlib.contrast("#e0531f", "#0a0a0a");
  assert.ok(r >= 4.5, `accent on bg ${r}`);
  assert.equal(kitlib.grade(3.2), "graphic only");
  assert.equal(kitlib.grade(1.34), "fails");
});

test("slots: text can be replaced in the same HTML", () => {
  const h = `<h1 data-slot="headline">Old</h1><p data-slot="sub" class="x">s</p>`;
  assert.equal(kitlib.setSlots(h, { headline: "New <b>" }), `<h1 data-slot="headline">New &lt;b&gt;</h1><p data-slot="sub" class="x">s</p>`);
});

test("ZIP is valid (unzip -t) and keeps names", () => {
  const f = path.join(tmp, "t.zip");
  fs.writeFileSync(f, zip([{ name: "a/b.png", data: Buffer.from("hello") }, { name: "kit.json", data: Buffer.from("{}") }]));
  try { assert.match(execFileSync("unzip", ["-t", f]).toString(), /No errors/); } catch (e) { if ((e as { code?: string }).code !== "ENOENT") throw e; }
  assert.equal(execFileSync("python3", ["-I", "-c", "import zipfile,sys;print(zipfile.ZipFile(sys.argv[1]).namelist())", f]).toString().trim(), "['a/b.png', 'kit.json']");
});

test("project -> logo upload -> generate (template) -> PNG -> star -> export", async (t) => {
  const p = brand.createProject("Test Brand!");
  assert.equal(p.id, "test-brand");
  assert.throws(() => brand.generate(p.id, "post", { headline: "Hi" }), /logo and colors/);
  assert.throws(() => brand.attachFile(p.id, "logo-primary", Buffer.from("<svg><script>x</script></svg>")), /rejected/);
  assert.throws(() => brand.attachFile(p.id, "logo-primary", Buffer.from("not an image")), /SVG or PNG/);
  const k = brand.attachFile(p.id, "logo-primary", svg);
  assert.match(k.kit.logo.primary ?? "", /^logo-[0-9a-f]+\.svg$/);
  assert.equal(k.kit_rev, 2);
  const a = brand.generate(p.id, "post", { headline: "Ship it", sub: "Today" }, 3);
  assert.equal(a.length, 3);
  assert.ok(a.every((x) => x.gen === 1 && x.format === "post" && x.w === 1080));
  await brand.idle();
  const done = brand.listAssets(p.id, { gen: 1 });
  if (!brand.chrome()) { t.skip("no Chromium: render step not verified"); assert.ok(done.every((x) => x.status === "failed" && /Chromium/.test(x.error ?? ""))); return; }
  assert.ok(done.every((x) => x.status === "done"), JSON.stringify(done.map((x) => x.error)));
  const png = fs.readFileSync(brand.pngOf(p.id, done[0].id)!.path!);
  assert.deepEqual(brand.pngSize(png), { w: 1080, h: 1080 });
  const v = brand.generate(p.id, "post", { headline: "Ship it", sub: "Today" }, 1, done[0].id);
  await brand.idle();
  assert.equal(brand.getAsset(p.id, v[0].id)?.parent_id, done[0].id);
  brand.patchAsset(p.id, done[0].id, { starred: true, brief: { headline: "Ship it twice" } });
  await brand.idle();
  assert.match(brand.getAsset(p.id, done[0].id, true)!.html ?? "", /Ship it twice/);
  assert.equal(brand.listAssets(p.id, { starred: true }).length, 1);
  const z = brand.exportZip(p.id, null, { html: true, kit: true });
  const f = path.join(tmp, "e.zip"); fs.writeFileSync(f, z.data);
  const names = execFileSync("python3", ["-I", "-c", "import zipfile,sys;print('\\n'.join(zipfile.ZipFile(sys.argv[1]).namelist()))", f]).toString();
  assert.match(names, /post\/ship-it(-twice)?-v1\.png/); assert.match(names, /kit\.json/); assert.match(names, /html\//);
  brand.deleteProject(p.id);
  assert.equal(fs.existsSync(path.join(process.env.OS_BRAND_DIR!, p.id)), false);
});
