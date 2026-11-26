import { brandRoute, json, body } from "@/lib/brandapi";
import { generate } from "@/lib/brand";

type C = { params: Promise<{ id: string }> };
export const POST = brandRoute<C>(async (req, c) => {
  const b = await body(req);
  const assets = generate((await c.params).id, b.format, b.brief, b.n, typeof b.parent === "number" ? b.parent : undefined);
  return json({ gen: assets[0].gen, assets }, 202);
});
