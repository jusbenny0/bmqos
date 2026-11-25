import "server-only";
import { netmap } from "./netmap";
import * as dokploy from "./dokploy";
import * as github from "./github";
import { machines, call } from "./storage";
import { REAL, realOf, envsOf, envUrls, repoOf, slug, type Env, type EnvKind } from "./projects";
import { taskRows, type TaskRow } from "./paperclip";
import { demoOn, demoServices } from "./demo";

/* Service registry, read-only. Sources: Dokploy, agents on machines (OS_AGENTS: systemd, tunnel, cron),
   netmap (OS_NETMAP_STATIC/media). What a source doesn't know is null; nothing is guessed. Cache 30s. */
export interface Svc {
  id: string; name: string; project: string; machine: string; domain: string | null; addr: string; public: boolean;
  version: { branch: string; commit: string | null; at: string | null } | null;
  up: boolean; ms: number | null; certDays: number | null; deploy: { at: string; status: string } | null; source: string; at: number; // at = when the data was fetched (age = now - at)
 
}
export interface Unit { machine: string; unit: string; scope: string; port: number | null; active: boolean; state: string; since: number | null }
export interface Ingress { machine: string; hostname: string; service: string }
export interface CronJob { machine: string; source: string; name: string; schedule: string; lastRun: number | null; ok: boolean | null }
export interface Collected { svcs: Svc[]; apps: dokploy.AppRow[]; ingress: Ingress[]; cron: CronJob[]; live: { dokploy: boolean; github: boolean; netmap: boolean; agents: Record<string, boolean> } }

const probes = new Map<string, { at: number; r: { up: boolean; ms: number | null } }>();
const http = async (url: string): Promise<{ up: boolean; ms: number | null }> => {
  const hit = probes.get(url);
  if (hit && Date.now() - hit.at < 60_000) return hit.r;
  const t0 = Date.now();
  const res = await fetch(url, { redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(5000) }).catch(() => null);
  const r = res && res.status < 500 ? { up: true, ms: Date.now() - t0 } : { up: false, ms: null };
  probes.set(url, { at: Date.now(), r });
  return r;
};

// cloudflared "service" (http://localhost:3200) → port; others (http_status:404) → null
const portOf = (service: string): number | null => { const m = /^https?:\/\/[^/]+?:(\d+)/.exec(service); return m ? +m[1] : null; };
const hostOf = (url: string): string => { try { return new URL(url).hostname; } catch { return ""; } };

/* tunnel destination ("service" from cloudflared) → machine name: localhost = the machine running the tunnel, IP/host via Proxmox, netmap and agents; unknown destination → "" (caller falls back to s.machine || bare host) */
const machineOf = (guests: { name: string; ip: string }[], svcs: { machine: string; ip: string }[], agents: { name: string; url: string }[]) =>
  (service: string, own: string): string => {
    const h = hostOf(service);
    if (!h) return own;
    if (h === "localhost" || h.startsWith("127.") || h === "::1" || h === "[::1]") return own; // URL keeps IPv6 in square brackets
    return guests.find((g) => g.ip === h)?.name || svcs.find((x) => x.ip === h && x.machine)?.machine || agents.find((m) => hostOf(m.url) === h)?.name || "";
  };

let memo: { at: number; v: Collected } | null = null;
export const collect = async (): Promise<Collected> => {
  if (demoOn()) return { svcs: demoServices(), apps: [], ingress: [], cron: [], live: { dokploy: false, github: false, netmap: false, agents: {} } };
  if (memo && Date.now() - memo.at < Number(process.env.OS_SVC_TTL_MS ?? 30_000)) return memo.v;
  const [nm, apps, agents] = await Promise.all([
    netmap().catch(() => null), dokploy.apps(),
    Promise.all(machines().map(async (m) => {
      const [u, t, c] = await Promise.all([call<Unit[]>(m, "/services"), call<Ingress[]>(m, "/tunnel"), call<CronJob[]>(m, "/cron")]);
      return { m, ok: u !== null, units: (u ?? []).map((x) => ({ ...x, machine: m.name })), ingress: (t ?? []).map((x) => ({ ...x, machine: m.name })), cron: (c ?? []).map((x) => ({ ...x, machine: m.name })) };
    })),
  ]);
  const now = Date.now(), byDomain = new Map((apps ?? []).flatMap((a) => a.domains.map((d) => [d, a] as const)));
  const known = machineOf(nm?.guests ?? [], nm?.services ?? [], machines());
  const ingress = agents.flatMap((a) => a.ingress);
  const row = (s: Omit<Svc, "at" | "public">): Svc => ({ ...s, public: !!s.domain, at: now });
  const hostPort = (a: (typeof agents)[number], u: Unit) => ({ host: hostOf(a.m.url), ing: a.ingress.find((i) => u.port !== null && portOf(i.service) === u.port) });

  // Service sources: an additional source = one more function in this array, callers don't change.
  const sources: Array<[string, () => Promise<Svc[]>]> = [
    ["netmap", async () => Promise.all((nm?.services ?? []).map(async (s) => { // netmap (OS_NETMAP_STATIC, media: read-only)
      const h = s.domain ? await http(`https://${s.domain}`) : { up: s.up, ms: s.ms }; // HTTP probe (5xx = down)
      return row({
        id: s.id, name: s.name, project: "", machine: s.machine, domain: s.domain, addr: s.ip ? `${s.ip}:${s.port}` : `:${s.port}`,
        version: null, ...h, certDays: s.certDays, deploy: null, source: s.source,
      });
    }))],
    ["agenti", async () => Promise.all(agents.flatMap((a) => a.units.map(async (u) => { // systemd units from agents
      const { host, ing } = hostPort(a, u);
      const p = u.active && u.port ? await http(`http://${host}:${u.port}`) : { up: u.active, ms: null };
      return row({
        id: `${a.m.name}:${u.scope}:${u.unit}`, name: u.unit, project: "", machine: a.m.name, domain: ing?.hostname ?? null, addr: u.port ? `${host}:${u.port}` : "",
        version: null, up: u.active && (u.port ? p.up : true), ms: p.ms, certDays: null,
        deploy: u.since ? { at: new Date(u.since).toISOString(), status: u.state } : null, source: "agent",
      });
    })))],
    ["tunel", async () => { // domains from the tunnel that no other source knows about
      const seen = new Set([...(nm?.services ?? []).map((s) => s.domain), ...agents.flatMap((a) => a.units.map((u) => hostPort(a, u).ing?.hostname))]);
      return Promise.all(ingress.filter((i) => !seen.has(i.hostname) && !i.hostname.startsWith("*")).map(async (i) =>
        row({ id: `tunnel:${i.hostname}`, name: i.hostname, project: "", machine: known(i.service, i.machine) || hostOf(i.service), domain: i.hostname, addr: "", version: null, ...(await http(`https://${i.hostname}`)), certDays: null, deploy: null, source: "tunel" })));
    }],
  ];
  const svcs = (await Promise.all(sources.map(([n, f]) => f().catch((e) => { console.warn(`services: source ${n} failed`, e instanceof Error ? e.message : e); return [] as Svc[]; })))).flat();
  // Matching with Dokploy by domain (all sources): project, branch + commit, last deploy; machine from the tunnel → IP/host, otherwise from Dokploy
  await Promise.all(svcs.map(async (s) => {
    const ing = s.domain ? ingress.find((i) => i.hostname === s.domain) : undefined;
    if (ing) s.machine = known(ing.service, ing.machine) || s.machine || hostOf(ing.service);
    const a = s.domain ? byDomain.get(s.domain.toLowerCase()) : undefined;
    if (!a) return;
    const [c, d] = await Promise.all([a.repo && a.branch ? github.commit(a.repo, a.branch) : null, dokploy.deploys(a.id, a.kind)]);
    s.project = a.project;
    if (!ing && !s.machine && a.machine) s.machine = a.machine;
    if (a.branch) s.version = { branch: a.branch, commit: c?.sha ?? null, at: c?.at ?? null };
    if (d?.[0]) s.deploy = { at: d[0].at, status: d[0].status };
  }));
  svcs.sort((x, y) => Number(x.up) - Number(y.up) || Number(y.public) - Number(x.public) || x.name.localeCompare(y.name));
  const v: Collected = {
    svcs, apps: apps ?? [], ingress, cron: agents.flatMap((a) => a.cron),
    live: { dokploy: apps !== null, github: github.live(), netmap: nm !== null, agents: Object.fromEntries(agents.map((a) => [a.m.name, a.ok])) },
  };
  memo = { at: now, v };
  return v;
};

export const services = async (): Promise<Svc[]> => (await collect()).svcs;

/* ---------- Projects, read-only: project registry + environments + GitHub (ahead, PR) + tasks ---------- */
export interface ProjectView {
  id: string; name: string; repo: string | null; live: boolean; // live = a GitHub token is available
  envs: Partial<Record<EnvKind, Env & { ahead?: number | null; commits?: github.CommitRow[] }>>; ahead: number | null; prs: github.PrRow[] | null; tasks: TaskRow[];
}
export const projects = async (): Promise<ProjectView[]> => {
  const [c, tasks] = await Promise.all([collect(), taskRows().catch(() => [] as TaskRow[])]);
  return Promise.all(REAL.map(async (r) => {
    const envs = envsOf(r, c.svcs);
    const dom = envUrls(r).prod, app = c.apps.find((a) => a.domains.some((d) => dom.includes(d)));
    const repo = repoOf(r) || app?.repo || null;
    const prod = envs.find((e) => e.kind === "prod"), test = envs.find((e) => e.kind === "test");
    const [cmp, prs] = repo ? await Promise.all([
      prod?.branch && test?.branch ? github.compare(repo, prod.branch, test.branch) : null, github.pulls(repo),
    ]) : [null, null];
    const ahead = cmp?.ahead ?? null, byKind = Object.fromEntries(envs.map((e) => [e.kind, e.kind === "test" ? { ...e, ahead, commits: cmp?.commits ?? [] } : e]));
    return { id: slug(r.n), name: r.n, repo, live: github.live(), envs: byKind, ahead, prs, tasks: tasks.filter((t) => realOf(t.title, t.project) === r) };
  }));
};
/* for cards: one project by id */
export const getProject = async (id: string): Promise<ProjectView | undefined> => (await projects()).find((x) => x.id === id);
