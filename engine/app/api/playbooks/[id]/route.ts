import { NextResponse } from "next/server";
import { loadPlaybook, playbookBrief, resetOverride, saveOverride, validId } from "@/lib/playbooks";

const out = (id: string) => { const p = loadPlaybook(id); return p && { ...p, brief: playbookBrief(p) }; };

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const p = validId(id) && out(id);
  return p ? NextResponse.json(p) : NextResponse.json({ error: "not found" }, { status: 404 });
}

// PATCH: partial playbook (title, steps, security_rules, ...) saved as override in data/playbooks/; {"reset": true} removes it.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!validId(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object" || Array.isArray(b)) return NextResponse.json({ error: "object body required" }, { status: 400 });
  if (b.reset === true) { resetOverride(id); return out(id) ? NextResponse.json(out(id)) : NextResponse.json({ ok: true }); }
  if (!saveOverride(id, b)) return NextResponse.json({ error: "invalid playbook" }, { status: 400 });
  return NextResponse.json(out(id));
}
