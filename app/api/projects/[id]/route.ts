import { NextResponse } from "next/server";
import { getProject } from "@/lib/services";

export const dynamic = "force-dynamic";
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await getProject(id);
  return p ? NextResponse.json(p) : NextResponse.json({ error: "projekt neexistuje" }, { status: 404 });
}
