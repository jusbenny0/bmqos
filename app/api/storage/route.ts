import { NextResponse } from "next/server";
import { act, actionList, actionsOn, machinesNow, pools, topDirs } from "@/lib/storage";
import { guarded } from "@/lib/guard";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams, host = q.get("host"), path = q.get("path");
  if (host && path) return NextResponse.json({ top: await topDirs(host, path) });
  const [machines, pv] = await Promise.all([machinesNow(), pools()]);
  return NextResponse.json({ machines, pools: pv, actions: actionList(), actionsOn: actionsOn() });
}

/* tidy deletes files on a machine → tier 3: typed machine name + 2FA code (guard target = `action:machine`) */
export async function POST(req: Request) {
  const { host = "", name = "", confirm = false, typed = "", code = "" } = (await req.json().catch(() => ({}))) as { host?: string; name?: string; confirm?: boolean; typed?: string; code?: string };
  const target = `${name}:${host}`;
  try {
    const r = await guarded(req, "storage.tidy", target, { typed: typed === host ? target : undefined, code }, { host, name }, () => act(host, name, confirm === true));
    return r instanceof NextResponse ? r : NextResponse.json({ ok: true, ...r });
  } catch (e) { console.error("storage.tidy", e); return NextResponse.json({ error: "couldn't perform the action" }, { status: 409 }); }
}
