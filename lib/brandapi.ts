import "server-only";
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { sessionOf } from "./sessions";

// Brand API guard: a logged-in session, or the MCP bearer token OS_BRAND_TOKEN (proxy.ts lets /api/brand with an Authorization header through).
const bearer = (req: Request): boolean => {
  const want = Buffer.from(process.env.OS_BRAND_TOKEN ?? ""), got = Buffer.from(req.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1] ?? "");
  return want.length > 0 && want.length === got.length && timingSafeEqual(want, got);
};
export const brandRoute = <C>(fn: (req: Request, ctx: C) => Promise<Response> | Response) => async (req: Request, ctx: C): Promise<Response> => {
  if (!sessionOf(req) && !bearer(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try { return await fn(req, ctx); }
  catch (e) {
    const m = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: m }, { status: m === "not found" ? 404 : 400 });
  }
};
export const json = (v: unknown, status = 200): Response => NextResponse.json(v, { status });
export const body = async (req: Request): Promise<Record<string, unknown>> => (await req.json().catch(() => ({}))) as Record<string, unknown>;
