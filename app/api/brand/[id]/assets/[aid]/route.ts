import fs from "node:fs";
import { brandRoute, json, body } from "@/lib/brandapi";
import { deleteAsset, getAsset, patchAsset, pngOf } from "@/lib/brand";

type C = { params: Promise<{ id: string; aid: string }> };
export const dynamic = "force-dynamic";
const ref = async (c: C) => { const { id, aid } = await c.params; return { id, n: Number(aid.replace(/\.png$/, "")), png: aid.endsWith(".png") }; };
// /assets/12 -> JSON with HTML source; /assets/12.png -> the image (PNG only, the HTML is never served as a page)
export const GET = brandRoute<C>(async (req, c) => {
  const { id, n, png } = await ref(c);
  if (png) {
    const f = pngOf(id, n);
    if (f?.redirect) return Response.redirect(new URL(f.redirect, req.url), 302);
    if (!f?.path) return json({ error: "not found" }, 404);
    return new Response(new Uint8Array(fs.readFileSync(f.path)), { headers: { "Content-Type": "image/png", "Content-Disposition": `inline; filename="${id}-${n}.png"` } });
  }
  const a = getAsset(id, n, true);
  return a ? json(a) : json({ error: "not found" }, 404);
});
export const PATCH = brandRoute<C>(async (req, c) => { const { id, n } = await ref(c); return json(patchAsset(id, n, await body(req))); });
export const DELETE = brandRoute<C>(async (_r, c) => { const { id, n } = await ref(c); deleteAsset(id, n); return json({ ok: true }); });
