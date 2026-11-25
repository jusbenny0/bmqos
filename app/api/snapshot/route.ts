import { NextResponse } from "next/server";
import { snapshot } from "@/lib/paperclip";
import { sessionOf } from "@/lib/sessions";
import { demoOn } from "@/lib/demo";
import { simSet } from "@/lib/simulator";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!sessionOf(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sim = new URL(req.url).searchParams.get("sim"); // demo simulator: ?sim=1 starts, ?sim=0 stops
  if (sim && demoOn()) simSet(sim === "1");
  try {
    return NextResponse.json(await snapshot(), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message.slice(0, 80) : "chyba" }, { status: 502 });
  }
}
