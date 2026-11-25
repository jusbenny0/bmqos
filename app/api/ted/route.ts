import { NextResponse } from "next/server";
import { ted } from "@/lib/ted";

export const dynamic = "force-dynamic";

// login is guarded by proxy.ts; HTTP isn't cached, the SW only keeps the last copy for offline
export async function GET() {
  return NextResponse.json(await ted(), { headers: { "Cache-Control": "no-store" } });
}
