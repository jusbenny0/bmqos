import { NextResponse } from "next/server";
import { guarded } from "@/lib/guard";
import { ISSUE } from "@/lib/inbox";
import { updateTask, validatePatch, type TaskPatch } from "@/lib/tasks";

export const dynamic = "force-dynamic";

// reassign / edit a task: agent, priority, title only; session + CSRF + audit via guarded, without PAPERCLIP_WRITE=1 just a draft (403 draft)
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!ISSUE.test(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  const raw: unknown = await req.json().catch(() => null);
  const b = (raw && typeof raw === "object" ? raw : {}) as TaskPatch;
  const p: TaskPatch = { assigneeAgentId: b.assigneeAgentId, priority: b.priority, title: b.title };
  const bad = validatePatch(p);
  if (bad) return NextResponse.json({ error: bad }, { status: 400 });
  try {
    const r = await guarded(req, "task.update", id, {}, { id, ...p }, () => updateTask(id, p));
    return r instanceof NextResponse ? r : NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message.slice(0, 80) : "error" }, { status: 502 });
  }
}
