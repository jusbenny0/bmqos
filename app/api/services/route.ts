import { NextResponse } from "next/server";
import { collect } from "@/lib/services";
import { findings } from "@/lib/watch";

export const dynamic = "force-dynamic";
// read-only, no step-up needed; login is guarded by proxy.ts (same as other /api routes)
export async function GET() {
  const c = await collect();
  return NextResponse.json({ services: c.svcs, findings: await findings(), live: c.live });
}
