import "server-only";
import { sql } from "./db";
import { demoOn, demoMachines } from "./demo";

/* Storage: read-only agent on the machines (HTTP + token) → metrics into SQLite (7-day trend),
   Proxmox via API. Actions are allowlist-only + confirmation + audit, gated by OS_ACTIONS=1. Media is read-only. */
export interface Disk { mount: string; total: number; used: number; free: number }
export interface Metrics { host: string; at: number; disks: Disk[]; cpu: number; load: number[]; mem: { total: number; avail: number }; up: number }
export interface Machine { name: string; ok: boolean; m: Metrics | null; trend: { at: number; mount: string; pct: number }[] }
export interface Pool { name: string; type: string; total: number; used: number }

export const machines = (): { name: string; url: string; token: string }[] =>
  (process.env.OS_AGENTS ?? "").split(";").filter(Boolean).map((x) => { const [name, url, token] = x.split("|"); return { name, url, token }; });
export const actionsOn = (): boolean => process.env.OS_ACTIONS === "1";
const ACTIONS: Record<string, { agent: string; label: string }> = { tidy: { agent: "tidy", label: "Tidy up (disk-tidy)" } };
const NEVER = /media/i; // media never – not folder reads outside stats, not actions

const db = () => {
  const d = sql();
  d.exec("CREATE TABLE IF NOT EXISTS metric (at INTEGER, host TEXT, mount TEXT, used INTEGER, total INTEGER, cpu REAL, mem REAL); CREATE INDEX IF NOT EXISTS metric_ix ON metric (host, at)");
  return d;
};

export const call = async <T>(m: { url: string; token: string }, path: string, init?: RequestInit, ms = 25_000): Promise<T | null> => {
  const r = await fetch(m.url + path, { ...init, cache: "no-store", headers: { Authorization: `Bearer ${m.token}` }, signal: AbortSignal.timeout(ms) }).catch(() => null);
  return r?.ok ? ((await r.json()) as T) : null;
};

/* collection: called from the API (60 s cache); stores max 1 row / disk / 5 min, deletes older than 7 days */
let cache: { at: number; v: Machine[] } | null = null;
export const machinesNow = async (): Promise<Machine[]> => {
  if (demoOn()) return demoMachines();
  if (cache && Date.now() - cache.at < 60_000) return cache.v;
  const d = db(), ins = d.prepare("INSERT INTO metric VALUES (?,?,?,?,?,?,?)");
  const v = await Promise.all(machines().map(async (c): Promise<Machine> => {
    const m = await call<Metrics>(c, "/metrics");
    if (m) {
      const last = d.prepare("SELECT max(at) a FROM metric WHERE host=?").get(c.name) as { a: number | null };
      if (!last.a || Date.now() - last.a > 300_000) for (const k of m.disks) ins.run(Date.now(), c.name, k.mount, k.used, k.total, m.cpu, 1 - m.mem.avail / m.mem.total);
    }
    const trend = (d.prepare("SELECT at, mount, used*100.0/total pct FROM metric WHERE host=? AND at>? ORDER BY at").all(c.name, Date.now() - 7 * 864e5) as { at: number; mount: string; pct: number }[]);
    return { name: c.name, ok: !!m, m, trend };
  }));
  d.prepare("DELETE FROM metric WHERE at<?").run(Date.now() - 7 * 864e5);
  cache = { at: Date.now(), v };
  return v;
};

export const topDirs = async (host: string, path: string): Promise<{ path: string; size: number }[] | null> => {
  const c = machines().find((x) => x.name === host);
  if (!c || NEVER.test(path)) return null;
  return call(c, `/top?path=${encodeURIComponent(path)}`);
};

/* Proxmox API: PVE_API_URL + PVE_TOKEN="user@pve!tokenid=secret" (read-only role is enough) */
export const pools = async (): Promise<Pool[]> => {
  if (!process.env.PVE_API_URL || !process.env.PVE_TOKEN) return [];
  const r = await fetch(`${process.env.PVE_API_URL}/api2/json/cluster/resources?type=storage`, { cache: "no-store", headers: { Authorization: `PVEAP...EN}` }, signal: AbortSignal.timeout(15_000) }).catch(() => null);
  const j = r?.ok ? ((await r.json()) as { data: { storage: string; plugintype: string; maxdisk: number; disk: number }[] }) : null;
  return (j?.data ?? []).map((s) => ({ name: s.storage, type: s.plugintype, total: s.maxdisk, used: s.disk }));
};

/* actions: allowlist + confirmation only; authorization, step-up and audit are handled by guarded() in the route */
export const act = async (host: string, name: string, confirm: boolean): Promise<{ out: string }> => {
  const c = machines().find((x) => x.name === host), a = ACTIONS[name];
  if (!c || !a) throw new Error("action not allowed");
  if (!confirm) throw new Error("missing confirmation");
  const r = await call<{ out: string }>(c, `/act?name=${a.agent}`, { method: "POST" }, 310_000); // disk-tidy can take up to 300 s
  if (!r) throw new Error("agent did not perform the action");
  return { out: r.out };
};
export const actionList = (): { id: string; label: string }[] => Object.entries(ACTIONS).map(([id, a]) => ({ id, label: a.label }));
