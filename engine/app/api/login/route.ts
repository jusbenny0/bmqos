import { NextResponse } from "next/server";
import { COOKIE, SESSION_MAX_AGE_S, checkPassword, newSession } from "@/lib/auth";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { password?: string };
  if (!(await checkPassword(body.password ?? ""))) {
    return NextResponse.json({ error: "bad password" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, await newSession(), { httpOnly: true, sameSite: "lax", path: "/", maxAge: SESSION_MAX_AGE_S });
  return res;
}
