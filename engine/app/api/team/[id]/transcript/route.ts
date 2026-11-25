import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const q = new URL(req.url).searchParams;
  const after = Number(q.get("after") ?? 0);
  const limit = Math.min(Math.max(Number(q.get("limit") ?? 200), 1), 500);
  if (!Number.isInteger(after) || after < 0 || !Number.isInteger(limit)) {
    return NextResponse.json({ error: "bad after/limit" }, { status: 400 });
  }
  if (!db().prepare("SELECT 1 FROM employees WHERE id = ?").get(id)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const messages = db()
    .prepare(
      `SELECT id, role, content, task_id, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, created_at
       FROM messages WHERE employee_id = ? AND id > ? ORDER BY id LIMIT ?`,
    )
    .all(id, after, limit) as { id: number }[];
  return NextResponse.json({ messages, last_id: messages.at(-1)?.id ?? after });
}
