import { NextResponse } from "next/server";
import { addDecision } from "@/lib/brain";

export async function POST(req: Request) {
  const { title, text } = (await req.json().catch(() => ({}))) as { title?: string; text?: string };
  if (!title?.trim() || !text?.trim()) return NextResponse.json({ error: "title and text are required" }, { status: 400 });
  return NextResponse.json(addDecision(title.trim(), text.trim()), { status: 201 });
}
