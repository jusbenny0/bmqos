import { NextResponse } from "next/server";
import { sameOrigin, to } from "@/lib/origin";
import { append } from "@/lib/audit";
import { COOKIE } from "@/lib/session";
import { revoke, sessionOf } from "@/lib/sessions";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "cross-origin request" }, { status: 403 });
  const s = sessionOf(req);
  if (s) { revoke(s.id); append({ session: s.id, action: "logout", tier: 0, target: "os", status: "ok" }); }
  const res = NextResponse.redirect(to(req, "/login"), 303);
  res.cookies.delete(COOKIE);
  return res;
}
