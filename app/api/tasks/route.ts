import { NextResponse } from "next/server";
import { guarded } from "@/lib/guard";
import { sessionOf } from "@/lib/sessions";
import { createTask, options, validate, type NewTask } from "@/lib/tasks";

export const dynamic = "force-dynamic";

// options for the new-task form (agents, projects, priorities, whether writes are enabled)
export async function GET(req: Request) {
  if (!sessionOf(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await options().catch(() => null) ?? { error: "Paperclip unavailable" }, { headers: { "Cache-Control": "no-store" } });
}

// new task: session + CSRF + audit via guarded; without PAPERCLIP_WRITE=1 it's just a draft (403 draft)
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as Partial<NewTask>;
  const bad = validate(b);
  if (bad) return NextResponse.json({ error: bad }, { status: 400 });
  const t = { ...(b as NewTask), description: b.description ?? "", zadani: b.zadani ?? "" };
  try {
    const r = await guarded(req, "task.create", t.title.trim().slice(0, 80), {}, { assignee: t.assigneeAgentId, project: t.projectId, priority: t.priority }, () => createTask(t));
    return r instanceof NextResponse ? r : NextResponse.json(r, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message.slice(0, 80) : "error" }, { status: 502 });
  }
}
