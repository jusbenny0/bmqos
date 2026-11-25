import { NextResponse } from "next/server";
import { send } from "@/lib/runtime";

export const maxDuration = 600;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = (await req.json().catch(() => ({}))) as { text?: string; taskId?: number };
  if (!b.text) return NextResponse.json({ error: "text required" }, { status: 400 });
  try {
    return NextResponse.json(await send(Number(id), b.text, b.taskId));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "send failed" }, { status: 500 });
  }
}
