import { NextResponse } from "next/server";
import { guarded } from "@/lib/guard";
import { dayOf, dismiss, get } from "@/lib/morning";
import { sessionOf } from "@/lib/sessions";

export const dynamic = "force-dynamic";

// today's morning card (null = not 8:30 yet or dismissed)
export async function GET(req: Request) {
  if (!sessionOf(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const m = get(dayOf(new Date()));
  return NextResponse.json({ card: m && !m.dismissed ? m.card : null }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const day = dayOf(new Date());
  const r = await guarded(req, "item.write", `morning:${day}`, {}, { op: "dismiss" }, async () => dismiss(day));
  return r instanceof NextResponse ? r : NextResponse.json({ ok: true });
}
