import { NextResponse } from "next/server";
import { sessionOf } from "@/lib/sessions";
import { review } from "@/lib/tasks";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!sessionOf(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const r = await review(new URL(req.url).searchParams.get("id") ?? "").catch(() => null);
  return r ? NextResponse.json(r, { headers: { "Cache-Control": "no-store" } }) : NextResponse.json({ error: "nenalezeno" }, { status: 404 });
}
