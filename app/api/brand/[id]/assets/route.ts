import { brandRoute, json } from "@/lib/brandapi";
import { listAssets } from "@/lib/brand";

type C = { params: Promise<{ id: string }> };
export const dynamic = "force-dynamic";
export const GET = brandRoute<C>(async (req, c) => {
  const q = new URL(req.url).searchParams;
  const gen = q.get("gen");
  return json(listAssets((await c.params).id, { gen: gen ? Number(gen) : undefined, format: q.get("format") ?? undefined, starred: q.get("starred") === "1" }));
});
