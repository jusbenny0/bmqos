import { NextResponse } from "next/server";
import { approveIdea } from "@/lib/ideas";

// POST {answers?: string[]}: one-click approval, creates the proposed tasks. Missing answers = recommended ones.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const b = (await req.json().catch(() => ({}))) as { answers?: unknown };
  const answers = Array.isArray(b.answers) ? b.answers.map((a) => String(a).slice(0, 300)) : [];
  const r = approveIdea(Number((await ctx.params).id), answers);
  return "error" in r ? NextResponse.json(r, { status: r.error === "not found" ? 404 : 409 }) : NextResponse.json(r);
}
