import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// Edit cwd (git worktree/branch for builders), system_prompt and reset session_id
// (PATCH {"session_id":null} = a fresh session, e.g. a new CEO session on request) without restarting the process.
const EDITABLE = ["name", "role", "model", "system_prompt", "cwd", "session_id", "engine", "engine_model"] as const;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const employee = db().prepare("SELECT * FROM employees WHERE id = ?").get(id);
  if (!employee) return NextResponse.json({ error: "not found" }, { status: 404 });
  const messages = db().prepare("SELECT * FROM messages WHERE employee_id = ? ORDER BY id").all(id);
  return NextResponse.json({ ...employee, messages });
}

// Edit cwd (git worktree/branch for builders) and system_prompt without restarting the process.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (b.model !== undefined && b.model !== "sonnet" && b.model !== "haiku") {
    return NextResponse.json({ error: "model must be sonnet|haiku" }, { status: 400 });
  }
  if (!db().prepare("SELECT 1 FROM employees WHERE id = ?").get(id)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const keys = EDITABLE.filter((k) => k in b);
  if (keys.length) {
    db().prepare(`UPDATE employees SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`)
      .run(...keys.map((k) => b[k] as string | number | null), id);
  }
  // Resetting session_id = a fresh session: also clear session_task_id/context_pct, otherwise they
  // would keep pointing at the old task/window.
  if ("session_id" in b && b.session_id === null) {
    db().prepare("UPDATE employees SET session_task_id = NULL, context_pct = 0 WHERE id = ?").run(id);
  }
  return NextResponse.json(db().prepare("SELECT * FROM employees WHERE id = ?").get(id));
}
