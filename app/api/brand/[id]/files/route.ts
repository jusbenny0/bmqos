import fs from "node:fs";
import { brandRoute, json } from "@/lib/brandapi";
import { attachFile, fileOf } from "@/lib/brand";

type C = { params: Promise<{ id: string }> };
export const dynamic = "force-dynamic";
// POST multipart {kind, file}; GET ?f=<relative path> serves logos for <img> (sandboxed, never inline)
export const POST = brandRoute<C>(async (req, c) => {
  const f = await req.formData();
  const file = f.get("file");
  if (!(file instanceof Blob) || file.size > 2_000_000) throw new Error("file: missing or over 2 MB");
  return json(attachFile((await c.params).id, String(f.get("kind")), Buffer.from(await file.arrayBuffer())));
});
export const GET = brandRoute<C>(async (req, c) => {
  const f = fileOf((await c.params).id, new URL(req.url).searchParams.get("f") ?? "");
  if (!f) return json({ error: "not found" }, 404);
  return new Response(new Uint8Array(fs.readFileSync(f.path)), { headers: { "Content-Type": f.type, "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'", "X-Content-Type-Options": "nosniff" } });
});
