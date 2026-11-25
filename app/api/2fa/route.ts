import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { append } from "@/lib/audit";
import { guarded } from "@/lib/guard";
import { sameOrigin } from "@/lib/origin";
import { clientIp, fail, openWindow, revokeOthers, sessionOf, windowOpen } from "@/lib/sessions";
import { checkCode, confirmEnroll, enrolled, startEnroll } from "@/lib/totp";

export const dynamic = "force-dynamic";
const shown = new Set<string>(); // sessions that already had the secret/QR shown (once per session)
interface Body { op?: string; code?: string; typed?: string }

export async function GET(req: Request) {
  const s = sessionOf(req);
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ enrolled: enrolled(), window: windowOpen(s), until: s.stepup_until }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as Body;
  const s = sameOrigin(req) ? sessionOf(req) : null;
  if (!s) return NextResponse.json({ error: "no valid session" }, { status: 403 });
  const ctx = { session: s.id, ip: clientIp(req), ua: req.headers.get("user-agent") ?? "" };
  try {
    // first-time setup: only while 2FA isn't confirmed yet (the otpauth URL is shown once)
    if (b.op === "enroll") {
      if (enrolled() || shown.has(s.id)) { append({ ...ctx, action: "2fa.enroll", tier: 1, target: "totp", status: "denied" }); return NextResponse.json({ error: enrolled() ? "2FA is already confirmed" : "QR already shown this session; sign in again" }, { status: 403 }); }
      const r = startEnroll(); shown.add(s.id); append({ ...ctx, action: "2fa.enroll", tier: 1, target: "totp", status: "ok" });
      return NextResponse.json({ secret: r.secret, qr: await QRCode.toDataURL(r.uri, { margin: 1, width: 220 }) });
    }
    if (b.op === "confirm") {
      const codes = confirmEnroll(b.code ?? "");
      append({ ...ctx, action: "2fa.confirm", tier: 1, target: "totp", status: codes ? "ok" : "denied" });
      if (!codes) { const locked = fail(s.id); return NextResponse.json({ error: locked ? "too many failures, sign in again" : "invalid code", need: locked ? "login" : "code" }, { status: 403 }); }
      return NextResponse.json({ backup: codes, until: openWindow(s.id) });
    }
    if (b.op === "verify") {
      if (!enrolled()) return NextResponse.json({ error: "2FA isn't set up", need: "enroll" }, { status: 403 });
      if (!checkCode(b.code ?? "")) {
        const locked = fail(s.id);
        append({ ...ctx, action: "2fa.verify", tier: 2, target: "stepup", status: "denied", result: locked ? "locked, session revoked" : "invalid code" });
        return NextResponse.json({ error: locked ? "too many failures, sign in again" : "invalid code", need: locked ? "login" : "code" }, { status: 403 });
      }
      append({ ...ctx, action: "2fa.verify", tier: 2, target: "stepup", status: "ok", stepup: "code" });
      return NextResponse.json({ until: openWindow(s.id) });
    }
    if (b.op === "revoke-others") {
      const r = await guarded(req, "session.revokeOthers", "sessions", b, null, async (x) => revokeOthers(x.id));
      return r instanceof NextResponse ? r : NextResponse.json({ revoked: r });
    }
    return NextResponse.json({ error: "invalid action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message.slice(0, 80) : "error" }, { status: 500 });
  }
}
