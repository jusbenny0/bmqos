import { NextResponse } from "next/server";
import { createFirstTask } from "@/lib/crew";
import { newSecret } from "@/lib/totp";
import { authEnv, onboarded, parseSetup, setupOk, saveSetup, skipSetup } from "@/lib/config";

export const dynamic = "force-dynamic";

// Only usable on first run; afterwards the instance is configured and this endpoint is closed.
export async function POST(req: Request) {
  if (onboarded()) return NextResponse.json({ error: "already set up" }, { status: 409 });
  if (!setupOk(req.headers.get("x-setup-token"))) return NextResponse.json({ error: "Wrong setup code (OS_SETUP_TOKEN)." }, { status: 403 });
  const raw = await req.text();
  if (raw.length > 16384) return NextResponse.json({ error: "too large" }, { status: 413 });
  const b = (() => { try { return JSON.parse(raw); } catch { return null; } })() as { skip?: boolean; password?: string; totp?: boolean } | null;
  if (b?.skip) { skipSetup(); return NextResponse.json({ ok: true }); }
  const s = parseSetup(b);
  if (!s) return NextResponse.json({ error: "Please fill in the company name, at least one agent and valid engine details." }, { status: 400 });
  const pw = typeof b?.password === "string" ? b.password : "";
  if (pw && pw.length < 8) return NextResponse.json({ error: "Password needs at least 8 characters." }, { status: 400 });
  saveSetup(s);
  const t = pw && b?.totp === true ? newSecret("admin") : null;
  const sent = await createFirstTask(s.goal.task, s.goal.goal);
  return NextResponse.json({ ok: true, env: pw ? authEnv(pw, t?.secret) : null, otpauth: t?.uri ?? null, taskSent: sent });
}
