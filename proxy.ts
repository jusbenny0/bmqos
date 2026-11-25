import { NextResponse, type NextRequest } from "next/server";
import { authOff, COOKIE, isSession } from "@/lib/session";
import { plainHttp, to } from "@/lib/origin";

// no valid session: nothing except /login and the login API; APIs return 401, pages redirect
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (plainHttp(req)) return NextResponse.redirect(to(req, pathname + req.nextUrl.search), 308);
  if (authOff()) return pathname === "/login" ? NextResponse.redirect(to(req, "/")) : NextResponse.next();
  const open = pathname === "/login" || pathname === "/api/login" || (pathname === "/api/cards" && req.headers.has("authorization")) || pathname.startsWith("/fonts/") || ["/sw.js", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png"].includes(pathname);
  if (open || isSession(req.cookies.get(COOKIE)?.value)) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.redirect(to(req, "/login"));
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
