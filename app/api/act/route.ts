import { NextResponse } from "next/server";
import { guarded } from "@/lib/guard";

export const dynamic = "force-dynamic";

const STATUSES = ["todo", "in_progress", "in_review", "blocked", "done", "cancelled"];
const ISSUE = /^[A-Z]{2,6}-\d{1,6}$/;
const UUID = /^[0-9a-f-]{36}$/;
interface Body { op?: string; id?: string; value?: string }

const call = async (method: string, path: string, body?: object): Promise<void> => {
  const res = await fetch(`${process.env.PAPERCLIP_API_URL ?? ""}${path}`, {
    method,
    headers: { Authorization: `Bearer ${process.env.PAPERCLIP_API_TOKEN ?? ""}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Paperclip ${res.status}`);
};

export async function POST(req: Request) {
  if (process.env.OS_CONTROL !== "1") return NextResponse.json({ error: "control is disabled" }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as Body;
  const { op, id = "", value = "" } = b;
  const valid = (op === "agents" && id.length < 1200 && id.split(",").every((x) => UUID.test(x)) && ["pause", "resume"].includes(value))
    || (op === "agent" && UUID.test(id) && ["pause", "resume", "wakeup"].includes(value))
    || (op === "status" && ISSUE.test(id) && STATUSES.includes(value))
    || (op === "assign" && ISSUE.test(id) && UUID.test(value))
    || (op === "reply" && ISSUE.test(id) && value.trim() && value.length < 4000);
  if (!valid) return NextResponse.json({ error: "invalid action" }, { status: 400 });
  try {
    const r = await guarded(req, "control.act", `${op}:${id}`, {}, { op, id, value: op === "reply" ? "[text]" : value }, async () => {
      if (op === "agents") for (const a of id.split(",")) await call("POST", `/agents/${a}/${value}`, {});
      else if (op === "agent") await call("POST", `/agents/${id}/${value}`, {});
      else if (op === "status") await call("PATCH", `/issues/${id}`, { status: value });
      else if (op === "assign") await call("PATCH", `/issues/${id}`, { assigneeAgentId: value });
      else await call("POST", `/issues/${id}/comments`, { body: `**Owner (via BMQOS):** ${value.trim()}` });
    });
    if (r instanceof NextResponse) return r;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message.slice(0, 80) : "error" }, { status: 502 });
  }
}
