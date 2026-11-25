import "server-only";
import { connect as tcp } from "node:net";
import { connect as tls } from "node:tls";
import { lookup } from "node:dns/promises";
import { sql } from "./db";
import { record } from "./metrics";
import { demoNetmap, demoOn } from "./demo";

/* Network map, read-only. Sources: Proxmox API (PVE_API_URL + PVE_TOKEN), Dokploy (read client below),
   static list OS_NETMAP_STATIC (JSON [{name,machine,ip,port,domain?,https?}]) for services the API doesn't know.
   Probes from the OS: TCP/TLS/HTTP, cache 60 s => max 1 probe/service/min. No agent on the machines, no SSH. */
export interface Service {
  id: string; name: string; machine: string; ip: string; port: number; domain: string | null; scope: "public" | "lan";
  up: boolean; ms: number | null; certExpires: string | null; certDays: number | null; url: string | null; isNew: boolean; source: string;
}
interface Guest { id: string; name: string; node: string; type: "lxc" | "qemu"; running: boolean; ip: string }
export interface TreeNode { kind: "node" | "guest" | "service" | "domain"; name: string; status?: string; children: TreeNode[] }

const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; r: Pick<Service, "up" | "ms" | "certExpires" | "certDays"> }>();

const pve = async <T>(path: string): Promise<T | null> => {
  if (!process.env.PVE_API_URL || !process.env.PVE_TOKEN) return null;
  const r = await fetch(`${process.env.PVE_API_URL}/api2/json/${path}`, { cache: "no-store", headers: { Authorization: `PVEAP...EN}` }, signal: AbortSignal.timeout(15_000) }).catch(() => null);
  return r?.ok ? (((await r.json().catch(() => null)) as { data: T } | null)?.data ?? null) : null;
};

const guests = async (): Promise<Guest[] | null> => {
  if (!process.env.PVE_API_URL || !process.env.PVE_TOKEN) return null;
  const res = await pve<{ vmid: number; name: string; node: string; type: string; status: string }[]>("cluster/resources?type=vm");
  if (!res) return null;
  return Promise.all(res.map(async (g): Promise<Guest> => {
    const lxc = g.type === "lxc", running = g.status === "running";
    const nics = lxc && running ? await pve<{ name: string; inet?: string }[]>(`nodes/${g.node}/lxc/${g.vmid}/interfaces`) : null;
    const ip = nics?.find((n) => n.name !== "lo" && n.inet)?.inet?.split("/")[0] ?? "";
    return { id: String(g.vmid), name: g.name, node: g.node, type: lxc ? "lxc" : "qemu", running, ip };
  }));
};

const tcpMs = (host: string, port: number): Promise<number | null> => new Promise((ok) => {
  const t0 = Date.now(), s = tcp({ host, port, timeout: 4000 });
  s.once("connect", () => { s.destroy(); ok(Date.now() - t0); });
  s.once("error", () => ok(null)); s.once("timeout", () => { s.destroy(); ok(null); });
});
const cert = (host: string, port: number): Promise<{ ms: number; exp: string; days: number } | null> => new Promise((ok) => {
  const t0 = Date.now(), s = tls({ host, port, servername: host, timeout: 5000, rejectUnauthorized: false }, () => {
    const c = s.getPeerCertificate(); s.destroy();
    const ms = Date.now() - t0, d = c?.valid_to ? new Date(c.valid_to) : null;
    ok(d ? { ms, exp: d.toISOString(), days: Math.floor((d.getTime() - Date.now()) / 864e5) } : null);
  });
  s.once("error", () => ok(null)); s.once("timeout", () => { s.destroy(); ok(null); });
});

const probe = async (id: string, host: string, port: number, https: boolean) => {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.r;
  const c = https ? await cert(host, port) : null;
  const ms = c ? c.ms : await tcpMs(host, port);
  const r = { up: ms !== null, ms, certExpires: c?.exp ?? null, certDays: c?.days ?? null };
  cache.set(id, { at: Date.now(), r });
  if (ms !== null) record(`svc:${id.toLowerCase().replace(/[^a-z0-9:_.-]/g, "-")}`.slice(0, 64), ms);
  return r;
};

interface Def { name: string; machine: string; ip: string; port: number; domain: string | null; https: boolean; source: string }
const parseStatic = (): Def[] => {
  try {
    const a = JSON.parse(process.env.OS_NETMAP_STATIC ?? "[]") as Partial<Def>[];
    return a.filter((x) => x.name && x.ip && x.port).map((x) => ({ name: x.name!, machine: x.machine ?? "", ip: x.ip!, port: x.port!, domain: x.domain ?? null, https: !!x.https, source: "static" }));
  } catch { return []; }
};

// minimal Dokploy read client (only GET project.all, apps + domains); response shape unverified against a live instance.
// project.all doesn't have domains directly on applications/compose (only their id/name/status; domains only
// show up in application.one/compose.one — see lib/dokploy.ts) — so this path returns [] against a live instance and is
// inactive; domains of public Dokploy apps go through the cloudflared tunnel and are matched in lib/services.ts.
interface DProj { name: string; environments?: { applications?: { name: string; domains?: { host: string }[] }[] }[] }
const apps = async (): Promise<{ name: string; domains: string[] }[] | null> => {
  const { DOKPLOY_URL: url, DOKPLOY_TOKEN: key } = process.env;
  if (!url || !key) return null;
  const res = await fetch(`${url}/api/project.all`, { headers: { "x-api-key": key }, cache: "no-store", signal: AbortSignal.timeout(20_000) }).catch(() => null);
  const p = res?.ok ? ((await res.json().catch(() => null)) as DProj[] | null) : null;
  return p && p.flatMap((x) => (x.environments ?? []).flatMap((e) => (e.applications ?? []).map((a) => ({ name: a.name, domains: (a.domains ?? []).map((d) => d.host) }))));
};

// Dokploy apps with a public domain: IP = DNS, port 443 (Traefik); machine = OS_DOKPLOY_MACHINE
const dokployDefs = async (): Promise<Def[]> => {
  const rows = (await apps().catch(() => null)) ?? [];
  const out: Def[] = [];
  for (const a of rows) for (const d of a.domains) {
    const ip = (await lookup(d).catch(() => null))?.address ?? "";
    out.push({ name: a.name, machine: process.env.OS_DOKPLOY_MACHINE ?? "dokploy", ip, port: 443, domain: d, https: true, source: "dokploy" });
  }
  return out;
};

const seen = (ids: string[]): Set<string> => {
  const db = sql();
  db.exec("CREATE TABLE IF NOT EXISTS netmap_seen (id TEXT PRIMARY KEY, first TEXT)");
  const known = new Set((db.prepare("SELECT id FROM netmap_seen").all() as { id: string }[]).map((r) => r.id));
  const fresh = new Set<string>();
  const cutoff = Date.now() - 864e5;
  if (known.size === 0) { // first run = baseline, nothing is "new"
    for (const id of ids) db.prepare("INSERT OR IGNORE INTO netmap_seen VALUES (?,?)").run(id, new Date(0).toISOString());
    return fresh;
  }
  for (const id of ids) {
    if (!known.has(id)) db.prepare("INSERT OR IGNORE INTO netmap_seen VALUES (?,?)").run(id, new Date().toISOString());
  }
  for (const r of db.prepare("SELECT id, first FROM netmap_seen").all() as { id: string; first: string }[]) if (new Date(r.first).getTime() > cutoff) fresh.add(r.id);
  return fresh;
};

export const netmap = async (): Promise<{ services: Service[]; guests: Guest[]; live: { proxmox: boolean; dokploy: boolean } }> => {
  if (demoOn()) return demoNetmap();
  const g = await guests();
  const defs = [...(await dokployDefs()), ...parseStatic()];
  const ids = defs.map((d) => `${d.machine}:${d.name}:${d.domain ?? d.ip}:${d.port}`);
  const fresh = seen(ids);
  const services = await Promise.all(defs.map(async (d, i): Promise<Service> => {
    const p = await probe(ids[i], d.domain ?? d.ip, d.port, d.https);
    return {
      id: ids[i], name: d.name, machine: d.machine, ip: d.ip, port: d.port, domain: d.domain, scope: d.domain ? "public" : "lan",
      ...p, url: d.domain ? `https://${d.domain}` : `${d.https ? "https" : "http"}://${d.ip}:${d.port}`, isNew: fresh.has(ids[i]), source: d.source,
    };
  }));
  return { services, guests: g ?? [], live: { proxmox: g !== null, dokploy: !!process.env.DOKPLOY_TOKEN && !!process.env.DOKPLOY_URL } };
};

// Proxmox node → LXC/VM → services → domains; services are matched to the host by IP or machine name
export const tree = async (): Promise<TreeNode[]> => {
  const { services, guests: g } = await netmap();
  const svc = (s: Service): TreeNode => ({ kind: "service", name: `${s.name} :${s.port}`, status: s.up ? "up" : "down", children: s.domain ? [{ kind: "domain", name: s.domain, status: s.certDays !== null && s.certDays < 14 ? "cert" : s.up ? "up" : "down", children: [] }] : [] });
  const used = new Set<string>();
  const nodes = new Map<string, TreeNode>();
  for (const x of g) {
    const mine = services.filter((s) => (x.ip && s.ip === x.ip) || s.machine === x.name);
    mine.forEach((s) => used.add(s.id));
    const n = nodes.get(x.node) ?? { kind: "node" as const, name: x.node, children: [] };
    n.children.push({ kind: "guest", name: `${x.name} (${x.type} ${x.id}${x.ip ? " " + x.ip : ""})`, status: x.running ? "up" : "down", children: mine.map(svc) });
    nodes.set(x.node, n);
  }
  const rest = services.filter((s) => !used.has(s.id));
  const out = [...nodes.values()];
  if (rest.length) out.push({ kind: "node", name: "outside Proxmox", children: rest.map(svc) });
  return out;
};
