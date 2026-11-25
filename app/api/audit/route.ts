import { NextResponse } from "next/server";
import { recent, verify } from "@/lib/audit";
import { sessionOf } from "@/lib/sessions";

export const dynamic = "force-dynamic";

// audit is read-only: list + hash chain status (UI Settings → Audit)
export async function GET(req: Request) {
  if (!sessionOf(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const u = new URL(req.url), t = u.searchParams.get("tier");
  const limit = Math.min(Math.max(Number(u.searchParams.get("limit")) || 100, 1), 500);
  return NextResponse.json({ chain: u.searchParams.get("verify") === "1" ? verify() : undefined, items: recent(limit, t === null ? undefined : Number(t)) }, { headers: { "Cache-Control": "no-store" } });
}
