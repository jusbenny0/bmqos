import { NextResponse } from "next/server";
import { netmap } from "@/lib/netmap";

export const dynamic = "force-dynamic";
export async function GET() {
  return NextResponse.json(await netmap());
}
