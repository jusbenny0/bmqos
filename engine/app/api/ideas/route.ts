import { NextResponse } from "next/server";
import { createIdea, listIdeas, runDiscussion } from "@/lib/ideas";

export const dynamic = "force-dynamic";
export const GET = () => NextResponse.json(listIdeas());

// POST {text}: stores the idea and starts the discussion in the background (poll GET /api/ideas/:id until status != discussing).
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { text?: unknown };
  const text = typeof b.text === "string" ? b.text.trim() : "";
  if (!text || text.length > 4000) return NextResponse.json({ error: "text required (max 4000 chars)" }, { status: 400 });
  const idea = createIdea(text);
  void runDiscussion(idea.id);
  return NextResponse.json(idea, { status: 202 });
}
