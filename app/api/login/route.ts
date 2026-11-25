import { NextResponse } from "next/server";
import { snapshot } from "@/lib/paperclip";
import { isHttps, to } from "@/lib/origin";
import { append } from "@/lib/audit";
import { COOKIE, checkPassword, makeSession, sessionMaxAge } from "@/lib/session";
import { newSession } from "@/lib/sessions";

const fails = new Map<string, { n: number; until: number }>();
const glob = { n: 0, until: 0 }; // global limit: 30 failed attempts / 5 min across all IPs

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",").pop()?.trim() ?? "?"; // the trusted proxy adds the last entry, the first can be spoofed;
  const f = fails.get(ip);
  if (f && f.n >= 5 && f.until > Date.now()) return NextResponse.redirect(to(req, "/login?e=1"), 303);
  if (glob.until > Date.now() && glob.n >= 30) return NextResponse.redirect(to(req, "/login?e=1"), 303);
  const pw = String((await req.formData()).get("password") ?? "");
  if (!checkPassword(pw)) {
    if (glob.until <= Date.now()) { glob.n = 0; glob.until = Date.now() + 5 * 60_000; }
    glob.n++;
    append({ ip, ua: req.headers.get("user-agent") ?? "", action: "login", tier: 0, target: "os", status: "denied", result: "wrong password" });
    fails.set(ip, { n: (f?.n ?? 0) + 1, until: Date.now() + 5 * 60_000 });
    return NextResponse.redirect(to(req, "/login?e=1"), 303);
  }
  fails.delete(ip);
  void snapshot().catch(() => undefined); // warm the cache, so the first load after login isn't 12 s
  const id = newSession(req);
  append({ session: id, ip, ua: req.headers.get("user-agent") ?? "", action: "login", tier: 0, target: "os", status: "ok" });
  const res = NextResponse.redirect(to(req, "/"), 303);
  res.cookies.set(COOKIE, makeSession(id), { httpOnly: true, sameSite: "lax", secure: isHttps(req), path: "/", maxAge: sessionMaxAge });
  return res;
}
