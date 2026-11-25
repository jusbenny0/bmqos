import "server-only";
import { createHash } from "node:crypto";
import { sql } from "./db";
import { redact } from "./redact";

export interface Entry {
  actor?: string; session?: string; ip?: string; ua?: string; action: string; tier: number; target: string;
  params?: unknown; status: "intent" | "ok" | "failed" | "denied" | "draft"; stepup?: "none" | "window" | "code"; result?: string; ref?: number;
}
const fields = (r: Record<string, unknown>): string => JSON.stringify([r.ts, r.actor, r.session, r.ip, r.ua, r.action, r.tier, r.target, r.params, r.status, r.stepup, r.result, r.ref]);
const sha = (prev: string, r: Record<string, unknown>): string => createHash("sha256").update(prev + fields(r)).digest("hex");

// single audit write: hash chain in one transaction, secrets stripped via redact; copy to stdout (second copy in the container log)
export const append = (e: Entry): number => {
  const d = sql();
  const r: Record<string, unknown> = {
    ts: new Date().toISOString(), actor: e.actor ?? "owner", session: e.session ?? null, ip: e.ip ?? null, ua: e.ua?.slice(0, 120) ?? null,
    action: e.action, tier: e.tier, target: redact(e.target).slice(0, 200),
    params: e.params === undefined ? null : redact(JSON.stringify(e.params)).slice(0, 2000), status: e.status, stepup: e.stepup ?? null,
    result: e.result === undefined ? null : redact(e.result).slice(0, 500), ref: e.ref ?? null,
  };
  d.exec("BEGIN IMMEDIATE");
  try {
    const prev = (d.prepare("SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1").get() as { hash: string } | undefined)?.hash ?? "";
    const hash = sha(prev, r);
    const { lastInsertRowid } = d.prepare("INSERT INTO audit_log (ts,actor,session,ip,ua,action,tier,target,params,status,stepup,result,ref,prev,hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(r.ts as string, r.actor as string, r.session as string | null, r.ip as string | null, r.ua as string | null, r.action as string, r.tier as number, r.target as string, r.params as string | null, r.status as string, r.stepup as string | null, r.result as string | null, r.ref as number | null, prev, hash);
    d.exec("COMMIT");
    console.log(JSON.stringify({ audit: r, hash }));
    return Number(lastInsertRowid);
  } catch (err) { d.exec("ROLLBACK"); throw err; }
};

// chain verification: returns the number of the first broken row
export const verify = (): { ok: boolean; count: number; broken?: number; last: string } => {
  const rows = sql().prepare("SELECT * FROM audit_log ORDER BY id").all() as (Record<string, unknown> & { id: number; prev: string; hash: string })[];
  let prev = "";
  for (const r of rows) if (r.prev !== prev || sha(prev, r) !== r.hash) return { ok: false, count: rows.length, broken: r.id, last: prev };
  else prev = r.hash;
  return { ok: true, count: rows.length, last: prev };
};

export const recent = (limit: number, tier?: number): unknown[] =>
  sql().prepare(`SELECT id, ts, actor, ip, action, tier, target, status, stepup, result, ref FROM audit_log ${tier === undefined ? "" : "WHERE tier = ?"} ORDER BY id DESC LIMIT ?`).all(...(tier === undefined ? [limit] : [tier, limit]));
