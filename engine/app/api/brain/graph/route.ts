import { NextResponse } from "next/server";
import { graph } from "@/lib/brain";

export function GET() {
  return NextResponse.json(graph());
}
