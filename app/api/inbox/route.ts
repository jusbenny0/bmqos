import { NextResponse } from "next/server";
import { card, ISSUE } from "@/lib/inbox";
import { sessionOf } from "@/lib/sessions";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!sessionOf(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!ISSUE.test(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  const c = await card(id).catch(() => null);
  return c ? NextResponse.json(c, { headers: { "Cache-Control": "no-store" } }) : NextResponse.json({ error: "not found" }, { status: 404 });
}
