import { guarded } from "@/lib/guard";
import { RUN, call, pending, TTL } from "@/lib/hermes";

export const dynamic = "force-dynamic";

// Approval of a risky Hermes step: only once/deny and only for a run we offered ourselves in chat (valid 10 min, once). Audit handled by guarded (chat.approval) including the command.
export async function POST(req: Request) {
  const { run = "", choice = "" } = (await req.json().catch(() => ({}))) as { run?: string; choice?: string };
  if (!RUN.test(run) || (choice !== "once" && choice !== "deny")) return Response.json({ error: "invalid request" }, { status: 400 });
  return guarded(req, "chat.approval", run, {}, { choice, command: pending.get(run)?.command }, async () => {
    const p = pending.get(run);
    if (!p || Date.now() - p.at > TTL) { pending.delete(run); return Response.json({ error: "approval no longer valid" }, { status: 409 }); }
    pending.delete(run); // double-click = 409
    const r = await call(`/v1/runs/${run}/approval`, { method: "POST", body: JSON.stringify({ choice }) }).catch(() => null);
    if (r?.status === 404 || r?.status === 409) return Response.json({ error: "approval no longer valid" }, { status: 409 });
    if (!r?.ok) { pending.set(run, p); return Response.json({ error: "The assistant rejected the approval" }, { status: 502 }); }
    return Response.json({ ok: true });
  });
}
