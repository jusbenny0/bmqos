import { NextResponse } from "next/server";
import { askAdvisor, validSlug } from "@/lib/advisors";

export const maxDuration = 600;

export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  if (!validSlug(slug)) return NextResponse.json({ error: "invalid slug" }, { status: 400 });
  const b = (await req.json().catch(() => ({}))) as { question?: string };
  if (!b.question) return NextResponse.json({ error: "question required" }, { status: 400 });
  try {
    return NextResponse.json({ answer: await askAdvisor(slug, b.question) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "failed";
    return NextResponse.json({ error: msg }, { status: msg === "advisor not found" ? 404 : 500 });
  }
}
