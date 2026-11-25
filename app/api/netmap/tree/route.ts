import { NextResponse } from "next/server";
import { tree } from "@/lib/netmap";

export const dynamic = "force-dynamic";
export async function GET() {
  return NextResponse.json({ tree: await tree() });
}
