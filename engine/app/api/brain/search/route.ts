import { NextResponse } from "next/server";
import { search } from "@/lib/brain";

export function GET(req: Request) {
  return NextResponse.json({ results: search(new URL(req.url).searchParams.get("q") ?? "") });
}
