import { NextResponse } from "next/server";
import { ISSUE, note, prOf } from "@/lib/inbox";
import { doMerge, startHold } from "@/lib/merge";
import { guarded } from "@/lib/guard";
import { sameOrigin } from "@/lib/origin";

export const dynamic = "force-dynamic";
interface Body { action?: string; issue?: string; nonce?: string; confirm?: boolean }

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "cross-origin request" }, { status: 403 });
  const { action, issue = "", nonce = "", confirm = false } = (await req.json().catch(() => ({}))) as Body;
  if (!ISSUE.test(issue) || (action !== "start" && action !== "merge")) return NextResponse.json({ error: "invalid action" }, { status: 400 });
  try {
    const pr = await prOf(issue);
    if (!pr) return NextResponse.json({ error: "no PR for this task" }, { status: 404 });
    if (action === "start") return NextResponse.json({ nonce: startHold(pr.repo, pr.n) });
    const r = await guarded(req, "merge.pr", `${pr.repo}#${pr.n}`, {}, { issue, confirm }, () => doMerge(pr.repo, pr.n, nonce, confirm === true, pr.judge));
    if (r instanceof NextResponse) return r;
    await note(issue, `**Merge from BMQOS:** PR #${pr.n} (${pr.repo}) merged into ${r.base}.`);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message.slice(0, 120) : "error" }, { status: 409 });
  }
}
