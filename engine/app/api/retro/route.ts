import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureRetroTable, judge } from "@/lib/retro";

// GET = retrospectives overview (latest 100 + verdict counts), POST = judge pending items now.
export function GET() {
  ensureRetroTable();
  const rows = db().prepare(`SELECT l.id, e.name, l.task_id, l.kind, l.text, l.verdict, l.target, l.rule, l.created_at
    FROM learnings l JOIN employees e ON e.id = l.employee_id ORDER BY l.id DESC LIMIT 100`).all();
  const stats = db().prepare("SELECT verdict, COUNT(*) n FROM learnings GROUP BY verdict").all();
  return NextResponse.json({ stats, rows });
}

export async function POST() {
  return NextResponse.json(await judge());
}
