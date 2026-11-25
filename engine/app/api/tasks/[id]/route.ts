import { NextResponse } from "next/server";
import { db } from "@/lib/db";

const EDITABLE = ["title", "brief", "owner_id", "reviewer_id", "status", "handoff_note", "pr_url", "token_cap", "needs_qa", "needs_visual", "needs_security"] as const;
const STATUSES = ["todo", "doing", "review", "done", "blocked"];

function load(id: string) {
  const task = db().prepare("SELECT * FROM tasks WHERE id = ?").get(id);
  if (!task) return null;
  const events = db().prepare("SELECT * FROM events WHERE task_id = ? ORDER BY id").all(id);
  const tokens = db()
    .prepare(
      `SELECT COALESCE(SUM(input_tokens),0) AS input, COALESCE(SUM(output_tokens),0) AS output,
              COALESCE(SUM(cache_read_tokens),0) AS cache_read, COALESCE(SUM(cache_write_tokens),0) AS cache_write,
              COALESCE(SUM(cost_usd),0) AS cost_usd FROM messages WHERE task_id = ?`,
    )
    .get(id);
  const messages = db()
    .prepare(
      `SELECT m.id, m.role, m.employee_id, e.name AS employee, substr(m.content, 1, 1500) AS content,
              m.input_tokens + m.output_tokens + m.cache_write_tokens AS tokens, m.cost_usd, m.created_at
       FROM messages m JOIN employees e ON e.id = m.employee_id WHERE m.task_id = ? ORDER BY m.id`,
    )
    .all(id);
  return { ...task, events, messages, tokens };
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const t = load((await params).id);
  return t ? NextResponse.json(t) : NextResponse.json({ error: "not found" }, { status: 404 });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (b.status !== undefined && !STATUSES.includes(String(b.status))) {
    return NextResponse.json({ error: "bad status" }, { status: 400 });
  }
  const keys = EDITABLE.filter((k) => k in b);
  if (!load(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (keys.length) {
    db()
      .prepare(`UPDATE tasks SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = datetime('now') WHERE id = ?`)
      .run(...keys.map((k) => b[k] as string | number | null), id);
    if (keys.includes("status")) {
      db().prepare("INSERT INTO events (task_id, kind, text) VALUES (?, 'status', ?)").run(id, String(b.status));
    }
  }
  return NextResponse.json(load(id));
}
