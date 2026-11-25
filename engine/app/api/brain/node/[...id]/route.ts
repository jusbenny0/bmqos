import { NextResponse } from "next/server";
import { getNode } from "@/lib/brain";

export async function GET(_: Request, { params }: { params: Promise<{ id: string[] }> }) {
  const node = getNode((await params).id.join("/"));
  return node ? NextResponse.json(node) : NextResponse.json({ error: "not found" }, { status: 404 });
}
