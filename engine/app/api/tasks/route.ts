import { NextResponse } from "next/server";
import { db, type Task } from "@/lib/db";
import { TOKEN_CAP_BY_SIZE } from "@/lib/config";

export function GET() {
  return NextResponse.json(db().prepare("SELECT * FROM tasks ORDER BY id DESC").all());
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as Partial<Task>;
  if (!b.title) return NextResponse.json({ error: "title required" }, { status: 400 });
  // default budget by size from the brief (new tokens, excl. cache reads): S 300k, M 800k, otherwise 800k
  const size = /size\s*:?\s*S\b|\bS\s*\(small\)/i.test(b.brief ?? "") ? "S" : "M";
  const cap = b.token_cap ?? TOKEN_CAP_BY_SIZE[size];
  const r = db()
    .prepare("INSERT INTO tasks (title, brief, owner_id, reviewer_id, token_cap, needs_qa, needs_visual, needs_security) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(b.title, b.brief ?? "", b.owner_id ?? null, b.reviewer_id ?? null, cap, b.needs_qa ? 1 : 0, b.needs_visual ? 1 : 0, b.needs_security ? 1 : 0);
  db().prepare("INSERT INTO events (task_id, kind, text) VALUES (?, 'created', ?)").run(r.lastInsertRowid, b.title);
  return NextResponse.json(db().prepare("SELECT * FROM tasks WHERE id = ?").get(r.lastInsertRowid), { status: 201 });
}
