import { NextResponse } from "next/server";
import { getIdea } from "@/lib/ideas";

export const dynamic = "force-dynamic";
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const idea = getIdea(Number((await ctx.params).id));
  return idea ? NextResponse.json(idea) : NextResponse.json({ error: "not found" }, { status: 404 });
}
