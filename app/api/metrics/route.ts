import { NextResponse } from "next/server";
import { isRange, isSeries, read, type Point } from "@/lib/metrics";

export const dynamic = "force-dynamic";

/* GET /api/metrics?series=a,b&range=24h|7d|30d → { a: Point[], b: Point[] } */
export async function GET(req: Request): Promise<NextResponse> {
  const q = new URL(req.url).searchParams, range = q.get("range") ?? "24h";
  const names = (q.get("series") ?? "").split(",").filter(Boolean).slice(0, 8);
  if (!isRange(range) || !names.length || !names.every(isSeries)) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const out: Record<string, Point[]> = {};
  await Promise.all(names.map(async (n) => { out[n] = await read(n, range).catch(() => []); }));
  return NextResponse.json(out, { headers: { "Cache-Control": "no-store" } });
}
