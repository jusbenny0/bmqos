import "server-only";
import { sql } from "./db";
import { collect } from "./services";
import * as github from "./github";
import { machinesNow } from "./storage";

/* Drift watchdog, read-only. Anything that can't be checked (no token, network, rate limit) produces no finding.
   `since` = first time the finding was seen (SQLite), `id` = rule + object, so it can be snoozed. "hori" = finding has been open for over 30 min. */
export interface Finding { id: string; rule: string; severity: "hori" | "hermes"; project: string; text: string; since: number; href?: string }
type Raw = Omit<Finding, "severity" | "since">;

const num = (k: string, d: number): number => Number(process.env[k] ?? d) || d;

export const findings = async (): Promise<Finding[]> => {
  const c = await collect(), out: Raw[] = [];
  const maxBehind = num("WATCH_BEHIND", 20), testBranch = process.env.OS_TEST_BRANCH ?? "test";
  const apps = c.apps;

  for (const s of c.svcs) {
    if (s.domain && !s.up) out.push({ id: `domain-bez-sluzby:${s.domain}`, rule: "domain-bez-sluzby", project: s.project, text: `Domain ${s.domain} has no running service (${s.name} on ${s.machine || "?"} isn't responding).`, href: `https://${s.domain}` });
    if (s.certDays !== null && s.certDays < 14) out.push({ id: `certifikat:${s.domain ?? s.id}`, rule: "certifikat", project: s.project, text: `Certificate ${s.domain ?? s.name} expires in ${Math.max(s.certDays, 0)} days.`, href: s.domain ? `https://${s.domain}` : undefined });
  }
  const gh = new Set(["neexistujici-vetev", "produkce-za-testem"]), keep = new Set<string>(); // rules whose source didn't respond this time
  await Promise.all(apps.map(async (a) => {
    // a stopped / never-deployed app (idle) without a domain isn't drift, just an empty entry in Dokploy
    if (!a.domains.length && a.status !== "idle") out.push({ id: `sluzba-bez-domeny:${a.id}`, rule: "sluzba-bez-domeny", project: a.project, text: `App ${a.name} in Dokploy has no domain.` });
    if (!a.repo || !a.branch) return;
    const [exists, hasTest] = await Promise.all([github.branchExists(a.repo, a.branch), a.branch !== testBranch ? github.branchExists(a.repo, testBranch) : Promise.resolve(false)]);
    if (exists === null || hasTest === null) gh.forEach((r) => keep.add(r));
    if (exists === false) out.push({ id: `neexistujici-vetev:${a.id}`, rule: "neexistujici-vetev", project: a.project, text: `${a.name} deploys from branch ${a.branch}, which doesn't exist in ${a.repo}.`, href: `https://github.com/${a.repo}/branches` });
    else if (exists && hasTest) {
      const n = await github.ahead(a.repo, a.branch, testBranch);
      if (n === null) keep.add("produkce-za-testem");
      else if (n > maxBehind) out.push({ id: `produkce-za-testem:${a.id}`, rule: "produkce-za-testem", project: a.project, text: `${a.name}: branch ${testBranch} is ${n} commits ahead of ${a.branch} (limit ${maxBehind}).`, href: `https://github.com/${a.repo}/compare/${a.branch}...${testBranch}` });
    }
  }));
  for (const j of c.cron) if (j.ok === false) out.push({ id: `cron:${j.machine}:${j.name}`, rule: "cron", project: "", text: `Cron job "${j.name}" on ${j.machine} last failed.` });
  for (const m of await machinesNow()) for (const d of m.m?.disks ?? []) {
    const pct = Math.round((d.used / d.total) * 100);
    if (pct > 80) out.push({ id: `disk:${m.name}:${d.mount}`, rule: "disk", project: "", text: `Disk ${d.mount} on ${m.name} is ${pct}% full.` });
  }
  return stamp(out.sort((a, b) => a.id.localeCompare(b.id)), keep);
};

// first time a finding is seen; findings that disappear are removed from the table (except rules whose source didn't respond) (they start over once fixed and back)
const stamp = (raw: Raw[], keep: Set<string>): Finding[] => {
  const db = sql();
  db.exec("CREATE TABLE IF NOT EXISTS watch_seen (id TEXT PRIMARY KEY, since INTEGER)");
  const known = new Map((db.prepare("SELECT id, since FROM watch_seen").all() as { id: string; since: number }[]).map((r) => [r.id, r.since]));
  const now = Date.now(), ids = new Set(raw.map((r) => r.id));
  for (const id of known.keys()) if (!ids.has(id) && !keep.has(id.split(":")[0])) db.prepare("DELETE FROM watch_seen WHERE id=?").run(id);
  return raw.map((r) => {
    const since = known.get(r.id) ?? now;
    if (!known.has(r.id)) db.prepare("INSERT INTO watch_seen VALUES (?,?)").run(r.id, now);
    return { ...r, since, severity: now - since > 30 * 60_000 ? "hori" : "hermes" };
  });
};
