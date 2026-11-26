import { brandRoute } from "@/lib/brandapi";
import { exportZip } from "@/lib/brand";

type C = { params: Promise<{ id: string }> };
export const dynamic = "force-dynamic";
// ?assets=1,2,3 (default all) &html=1 &kit=1 &formats=post,og
export const GET = brandRoute<C>(async (req, c) => {
  const q = new URL(req.url).searchParams;
  const ids = q.get("assets")?.split(",").map(Number).filter(Number.isInteger) ?? null;
  const z = exportZip((await c.params).id, ids, { html: q.get("html") === "1", kit: q.get("kit") === "1", formats: q.get("formats")?.split(",") });
  return new Response(new Uint8Array(z.data), { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${z.name}"` } });
});
