import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { send } from "@/lib/runtime";

// Called by the CEO from its own session (curl + X-Crew-Token). Responds immediately; the work runs in the background.
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { to?: string | number; taskId?: number; text?: string };
  if (b.to === undefined || !b.taskId || !b.text) {
    return NextResponse.json({ error: "to, taskId, text required" }, { status: 400 });
  }
  const emp = db().prepare("SELECT id, name FROM employees WHERE id = ? OR lower(name) = lower(?)").get(b.to, String(b.to)) as
    | { id: number; name: string }
    | undefined;
  if (!emp) return NextResponse.json({ error: "employee not found" }, { status: 404 });
  if (!db().prepare("SELECT 1 FROM tasks WHERE id = ?").get(b.taskId)) {
    return NextResponse.json({ error: "task not found" }, { status: 404 });
  }
  db().prepare("INSERT INTO events (task_id, kind, text) VALUES (?, 'delegated', ?)").run(b.taskId, `${emp.name}: ${b.text}`);
  const taskId = b.taskId;
  // A delegated task has an owner and is running; the employee card shows it.
  db().prepare("UPDATE tasks SET owner_id = COALESCE(owner_id, ?), status = CASE WHEN status = 'todo' THEN 'doing' ELSE status END, updated_at = datetime('now') WHERE id = ?").run(emp.id, taskId);
  send(emp.id, b.text, taskId).catch((e: unknown) => {
    const msg = e instanceof Error ? e.message : "send failed";
    db().prepare("INSERT INTO events (task_id, kind, text) VALUES (?, 'error', ?)").run(taskId, msg);
    db().prepare("UPDATE tasks SET status = 'blocked', updated_at = datetime('now') WHERE id = ?").run(taskId);
    db().prepare("INSERT INTO events (task_id, kind, text) VALUES (?, 'blocked', ?)").run(taskId, `Launch failed: ${msg}`);
  });
  return NextResponse.json({ accepted: true, employeeId: emp.id }, { status: 202 });
}
