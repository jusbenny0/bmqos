import { NextResponse } from "next/server";
import type { PushSubscription } from "web-push";
import { allowedEndpoint, CATS, configured, devices, prefs, publicKey, sendTest, setPref, snooze, subscribe, unsubscribeId } from "@/lib/push";
import { sameOrigin } from "@/lib/origin";

export const dynamic = "force-dynamic";
interface Body { sub?: PushSubscription; id?: string; cat?: string; mode?: string; test?: boolean; snooze?: string; endpoint?: string }

export async function GET() {
  return NextResponse.json({ configured: configured(), key: publicKey(), cats: CATS, prefs: prefs(), devices: devices() });
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "cross-origin request" }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as Body;
  if (b.test) return NextResponse.json({ sent: configured() ? await sendTest() : 0 });
  if (b.snooze) return snooze(b.snooze, b.endpoint) ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "invalid" }, { status: 400 });
  if (b.cat && b.mode) return setPref(b.cat, b.mode) ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "invalid" }, { status: 400 });
  if (b.id && !b.sub) { unsubscribeId(b.id); return NextResponse.json({ ok: true }); }
  if (!b.sub?.endpoint || !allowedEndpoint(b.sub.endpoint) || !b.sub.keys?.auth || !b.sub.keys.p256dh) return NextResponse.json({ error: "invalid subscription" }, { status: 400 });
  subscribe(b.sub, req.headers.get("user-agent") ?? "");
  return NextResponse.json({ ok: true });
}
