import { NextResponse } from "next/server";
import { db, type Employee } from "@/lib/db";
import { personaOf } from "@/lib/config";

// Team card: current task + last step, tokens today, last message.
export function GET() {
  const d = db();
  const rows = d
    .prepare(
      `SELECT e.*,
        t.id AS task_id, t.title AS task_title, t.status AS task_status,
        (SELECT text FROM events WHERE task_id = t.id ORDER BY id DESC LIMIT 1) AS last_step,
        (SELECT COALESCE(SUM(input_tokens + output_tokens + cache_write_tokens), 0) FROM messages WHERE employee_id = e.id AND created_at >= date('now')) AS tokens_today,
        (SELECT content FROM messages WHERE employee_id = e.id AND role != 'user' ORDER BY id DESC LIMIT 1) AS last_message,
        (SELECT created_at FROM messages WHERE employee_id = e.id AND role != 'user' ORDER BY id DESC LIMIT 1) AS last_message_at
      FROM employees e
      LEFT JOIN tasks t ON t.id = (
        SELECT id FROM tasks WHERE status IN ('doing','review','todo') AND (owner_id = e.id OR (reviewer_id = e.id AND status = 'review'))
        ORDER BY CASE status WHEN 'doing' THEN 0 WHEN 'review' THEN 1 ELSE 2 END, id DESC LIMIT 1)
      ORDER BY e.id`,
    )
    .all();
  return NextResponse.json((rows as { persona: string | null }[]).map((r) => ({ ...r, persona: personaOf(r.persona) })));
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as Partial<Employee>;
  if (!b.name || !b.role || (b.model !== "sonnet" && b.model !== "haiku")) {
    return NextResponse.json({ error: "name, role, model (sonnet|haiku) required" }, { status: 400 });
  }
  const r = db()
    .prepare("INSERT INTO employees (name, role, model, system_prompt, cwd) VALUES (?, ?, ?, ?, ?)")
    .run(b.name, b.role, b.model, b.system_prompt ?? "", b.cwd ?? "");
  return NextResponse.json(db().prepare("SELECT * FROM employees WHERE id = ?").get(r.lastInsertRowid), { status: 201 });
}
