import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureEvalTable, evalRoles, loadCases, runEvals } from "@/lib/evals";

// GET = cases per role + latest runs. POST {role} = run that role's evals now (costs model calls).
export function GET() {
  ensureEvalTable();
  const roles = evalRoles().map((r) => ({ role: r, cases: loadCases(r).length }));
  const runs = db().prepare("SELECT id, role, label, passed, total, created_at FROM eval_runs ORDER BY id DESC LIMIT 50").all();
  return NextResponse.json({ roles, runs });
}

export async function POST(req: Request) {
  const { role } = (await req.json().catch(() => ({}))) as { role?: string };
  if (!role || !evalRoles().includes(role)) return NextResponse.json({ error: "unknown role" }, { status: 400 });
  return NextResponse.json(await runEvals(role, { label: "api" }));
}
