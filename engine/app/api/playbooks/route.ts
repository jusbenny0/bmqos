import { NextResponse } from "next/server";
import { defaultPlaybook, isOverridden, listPlaybooks, loadPlaybook, setDefault, validId } from "@/lib/playbooks";

export function GET() {
  const def = defaultPlaybook();
  return NextResponse.json(listPlaybooks().map((id) => {
    const p = loadPlaybook(id)!;
    return { id, title: p.title, description: p.description, default: id === def, overridden: isOverridden(id) };
  }));
}

// PATCH {default: "<id>"|null} sets the default playbook.
export async function PATCH(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { default?: unknown };
  if (b.default !== null && !(validId(b.default) && loadPlaybook(b.default))) return NextResponse.json({ error: "unknown playbook" }, { status: 400 });
  setDefault(b.default as string | null);
  return NextResponse.json({ default: defaultPlaybook() ?? null });
}
