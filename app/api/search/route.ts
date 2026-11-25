import { NextResponse } from "next/server";
import { search } from "@/lib/search";

export const dynamic = "force-dynamic";

// GET ?q= – read-only; session is guarded by proxy.ts
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q") ?? "";
  try { return NextResponse.json({ hits: await search(q) }); }
  catch { return NextResponse.json({ error: "search failed" }, { status: 502 }); }
}
