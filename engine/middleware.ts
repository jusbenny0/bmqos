import { NextRequest, NextResponse } from "next/server";
import { COOKIE, checkSession } from "@/lib/auth";

// Constant-time comparison; an empty CREW_API_TOKEN disables Bearer auth.
function same(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
function bearerOk(header: string | null): boolean {
  const m = header?.match(/^Bearer (.+)$/);
  return !!m && same(m[1], process.env.CREW_API_TOKEN ?? "");
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === "/login" || pathname === "/api/login") return NextResponse.next();

  if (pathname.startsWith("/api/") && bearerOk(req.headers.get("authorization"))) return NextResponse.next();

  if (pathname === "/api/delegate" || pathname.startsWith("/api/advisors/") || pathname.startsWith("/api/brain/") || pathname === "/api/tasks" || pathname.startsWith("/api/tasks/")) {
    if (same(req.headers.get("x-crew-token") ?? "", process.env.CREW_TOKEN ?? "")) return NextResponse.next();
  }

  if (req.method === "GET" && pathname.startsWith("/api/playbooks") && same(req.headers.get("x-crew-token") ?? "", process.env.CREW_TOKEN ?? "")) return NextResponse.next();

  const expected = await checkSession(req.cookies.get(COOKIE)?.value);
  if (expected) return NextResponse.next();

  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.redirect(new URL("/login", req.url));
}

export const config = { matcher: ["/((?!_next/|favicon.ico).*)"] };
