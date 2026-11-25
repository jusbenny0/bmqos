import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { send } from "@/lib/runtime";

export const maxDuration = 600;

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { text?: string };
  if (!b.text) return NextResponse.json({ error: "text required" }, { status: 400 });
  const ceo = db().prepare("SELECT id FROM employees WHERE role = 'ceo' ORDER BY id LIMIT 1").get() as { id: number } | undefined;
  if (!ceo) return NextResponse.json({ error: "no CEO" }, { status: 404 });
  try {
    return NextResponse.json(await send(ceo.id, b.text));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "send failed" }, { status: 500 });
  }
}
