import { NextResponse } from "next/server";
import { detect } from "@/lib/providers";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await detect());
}
