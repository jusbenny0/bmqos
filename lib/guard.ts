import "server-only";
import { NextResponse } from "next/server";
import { append } from "./audit";
import { sameOrigin } from "./origin";
import { clientIp, fail, sessionOf, windowOpen, type Sess } from "./sessions";
import { checkCode, enrolled } from "./totp";

/* The single barrier for action routes. T1 reversible write · T2 risky = step-up window 10 min · T3 irreversible = fresh code + retype the target.
   Unknown action = 400. Without the env flag enabled, `run` is never called: a draft is logged and 403 {draft:true} is returned (fail closed); exception `ownDraft` (the action handles its own draft). */
type Tier = 1 | 2 | 3;
export const ACTIONS: Record<string, { tier: Tier; env?: string; ownDraft?: boolean }> = {
  "chat.send": { tier: 1 },
  "chat.approval": { tier: 1 },
  "voice.draft": { tier: 1 },
  "control.act": { tier: 2, env: "OS_CONTROL" },
  "social.write": { tier: 1, env: "OS_CONTROL" }, // owner: approve/reject a post without a 2FA code
  "inbox.answer": { tier: 1, env: "PAPERCLIP_WRITE", ownDraft: true },
  "card.answer": { tier: 1 },
  "card.answer.sensitive": { tier: 2 },
  "item.write": { tier: 1 },
  "item.handoff": { tier: 1, env: "PAPERCLIP_WRITE" },
  "task.create": { tier: 1, env: "PAPERCLIP_WRITE" },
  "task.update": { tier: 1, env: "PAPERCLIP_WRITE" },
  "session.revokeOthers": { tier: 2 },
  "storage.tidy": { tier: 3, env: "OS_ACTIONS" },
  "docs.edit": { tier: 2, env: "OS_DOCS_WRITE" },
  "merge.pr": { tier: 2, env: "GITHUB_MERGE" },
};
export interface Proof { code?: string; typed?: string }
const no = (status: number, error: string, need?: string): NextResponse => NextResponse.json({ error, need }, { status });

// returns `run`'s result, or a finished error response (caller: `if (r instanceof NextResponse) return r`)
export async function guarded<T>(req: Request, actionId: string, target: string, proof: Proof, params: unknown, run: (s: Sess) => Promise<T>): Promise<T | NextResponse> {
  const a = ACTIONS[actionId];
  const s = a && sameOrigin(req) ? sessionOf(req) : null;
  const ctx = { session: s?.id, ip: clientIp(req), ua: req.headers.get("user-agent") ?? "" };
  const deny = (why: string, status: number, need?: string): NextResponse => { try { append({ ...ctx, action: actionId, tier: a?.tier ?? 0, target, status: "denied", result: why }); } catch { /* audit unavailable: the denial still stands */ } return no(status, why, need); };
  if (!a) return deny("unknown action", 400);
  if (!s) return deny("no valid session or cross-origin request", 403);
  const live = !a.env || process.env[a.env] === "1";
  let stepup: "none" | "window" | "code" = "none";
  if (!live && !a.ownDraft) {
    try { append({ ...ctx, action: actionId, tier: a.tier, target, params, status: "draft", stepup }); } catch { return no(500, "audit unavailable, action not performed"); }
    return NextResponse.json({ error: "live write is disabled, saved as a draft", draft: true }, { status: 403 });
  }
  if (live && a.tier >= 2) {
    if (!enrolled()) return deny("2FA isn't set up", 403, "enroll");
    if (a.tier === 2) {
      if (!windowOpen(s)) return deny("missing step-up", 403, "stepup");
      stepup = "window";
    } else {
      if (proof.typed !== target) return deny("target not retyped", 403, "typed");
      if (!proof.code || !checkCode(proof.code)) {
        const locked = fail(s.id);
        return deny(locked ? "too many failures, session revoked" : "invalid code", 403, locked ? "login" : "code");
      }
      stepup = "code";
    }
  }
  let ref: number;
  try { ref = append({ ...ctx, action: actionId, tier: a.tier, target, params, status: "intent", stepup }); } catch { return no(500, "audit unavailable, action not performed"); } // fail closed
  try {
    const r = await run(s);
    const bad = r instanceof Response && !r.ok;
    // the action already happened: an audit failure must not change the result (log only)
    try { append({ ...ctx, action: actionId, tier: a.tier, target, status: bad ? "failed" : live ? "ok" : "draft", stepup, ref, result: bad ? `HTTP ${r.status}` : undefined }); } catch (err) { console.error("post-action audit failed", err); }
    return r;
  } catch (e) {
    try { append({ ...ctx, action: actionId, tier: a.tier, target, status: "failed", stepup, ref, result: e instanceof Error ? e.message : "error" }); } catch (err) { console.error("post-action audit failed", err); }
    throw e;
  }
}
