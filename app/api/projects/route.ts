import { NextResponse } from "next/server";
import { projects } from "@/lib/services";

export const dynamic = "force-dynamic";
// read-only; login is guarded by proxy.ts
export async function GET() {
  return NextResponse.json({ projects: await projects() });
}
