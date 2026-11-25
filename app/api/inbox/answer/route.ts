import { NextResponse } from "next/server";
import { answer, ISSUE } from "@/lib/inbox";
import { guarded } from "@/lib/guard";

export const dynamic = "force-dynamic";
interface Body { issue?: string; qid?: string; value?: string }

export async function POST(req: Request) {
  const { issue = "", qid = "", value = "" } = (await req.json().catch(() => ({}))) as Body;
  if (!ISSUE.test(issue) || !/^\d{1,2}$/.test(qid) || !value.trim() || value.length > 3000) return NextResponse.json({ error: "invalid answer" }, { status: 400 });
  try {
    const r = await guarded(req, "inbox.answer", issue, {}, { issue, qid }, () => answer(issue, qid, value));
    if (r instanceof NextResponse) return r;
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message.slice(0, 80) : "error" }, { status: 502 });
  }
}
