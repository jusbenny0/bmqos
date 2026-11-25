import { NextResponse } from "next/server";
import { answer, card, SENSITIVE } from "@/lib/cards";
import { guarded } from "@/lib/guard";

export const dynamic = "force-dynamic";

// Owner's answer: session + CSRF + audit (guarded); public/money/key types require step-up (2FA code), other types don't
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const b = (await req.json().catch(() => ({}))) as { choice?: number };
  const c = Number.isInteger(id) ? card(id) : null;
  if (!c) return NextResponse.json({ error: "card not found" }, { status: 404 });
  if (c.choice !== null) return NextResponse.json({ error: "already answered" }, { status: 409 });
  if (!Number.isInteger(b.choice) || (b.choice as number) < 1 || (b.choice as number) > c.options.length) return NextResponse.json({ error: "invalid choice" }, { status: 400 });
  const choice = b.choice as number;
  const r = await guarded(req, SENSITIVE.includes(c.type) ? "card.answer.sensitive" : "card.answer", `card:${id}`, {}, { id, type: c.type, choice, label: c.options[choice - 1] }, async () => {
    if (!answer(id, choice)) throw new Error("answer failed to save");
  });
  return r instanceof NextResponse ? r : NextResponse.json({ ok: true });
}
