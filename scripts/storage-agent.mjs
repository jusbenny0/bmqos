// Read-only agent on the machine: node scripts/storage-agent.mjs
// ENV: AGENT_TOKEN (required), AGENT_PORT (9477), AGENT_PATHS="/,/srv,/mnt/data", AGENT_HOST (default 127.0.0.1; token goes over plain HTTP – only expose via a tunnel/proxy with TLS), AGENT_ACT=1 allows only allowlisted actions.
// (read-only) AGENT_UNITS="nginx,myapp=3100,user:preview=3201" (systemd allowlist, [system:|user:]unit[=port]),
// AGENT_TUNNEL_CFG (/etc/cloudflared/config.yml), AGENT_CRON_JSON (assistant cron, no default; tolerant shape, unverified).
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { timingSafeEqual } from "node:crypto";
import os from "node:os";

const TOKEN = process.env.AGENT_TOKEN ?? "";
if (TOKEN.length < 16) { console.error("AGENT_TOKEN must be at least 16 chars"); process.exit(1); }
const PATHS = (process.env.AGENT_PATHS ?? "/").split(",");
const ACT = process.env.AGENT_ACT === "1";
// allowlist: action → [command, args]; the agent runs nothing else, media is never deleted
const ACTIONS = { tidy: ["disk-tidy", []] };
const run = (cmd, args, ms) => new Promise((ok) => execFile(cmd, args, { timeout: ms, maxBuffer: 1 << 20 }, (e, out) => ok(e?.killed ? "" : out ?? "")));

const disks = async () => {
  const out = await run("df", ["-P", "-B1", ...PATHS], 5000);
  const seen = new Set(); // /, /srv on the same fs = one disk
  return out.trim().split("\n").slice(1).map((l) => { const c = l.split(/\s+/); return { fs: c[0], mount: c[5], total: +c[1], used: +c[2], free: +c[3] }; })
    .filter((d) => { const k = `${d.fs}|${d.total}`; if (seen.has(k)) return false; seen.add(k); return true; }).map(({ fs, ...d }) => d);
};
const meminfo = () => {
  const m = Object.fromEntries(readFileSync("/proc/meminfo", "utf8").split("\n").map((l) => l.split(/:\s+/)).filter((x) => x[1]).map(([k, v]) => [k, parseInt(v) * 1024]));
  return { total: m.MemTotal, avail: m.MemAvailable };
};
// top folders: du with a time limit, result cached for 10 min
const topCache = new Map();
const top = async (raw) => {
  let dir; try { dir = realpathSync(path.resolve(raw)); } catch { return null; } // normalize + symlinks
  if (/media/i.test(dir)) return null; // media never, enforced right in the agent
  if (!PATHS.some((p) => dir === p || dir.startsWith(p === "/" ? "/" : p + "/"))) return null;
  const hit = topCache.get(dir);
  if (hit && Date.now() - hit.at < 600_000) return hit.v;
  const out = await run("du", ["-x", "-d1", "-B1", dir], 20_000);
  const v = out.trim().split("\n").filter(Boolean).map((l) => { const [s, ...p] = l.split("\t"); return { path: p.join("\t"), size: +s }; })
    .filter((x) => x.path !== dir && !/media/i.test(x.path)).sort((a, b) => b.size - a.size).slice(0, 12);
  if (v.length) topCache.set(dir, { at: Date.now(), v }); // empty (timeout) not cached
  return v;
};

// systemd: only units from AGENT_UNITS; `systemctl show` changes nothing
const UNIT = /^[\w@.-]{1,80}$/;
const units = () => (process.env.AGENT_UNITS ?? "").split(",").map((x) => x.trim()).filter(Boolean).map((x) => {
  const m = /^(?:(system|user):)?([\w@.-]+?)(?:=(\d{1,5}))?$/.exec(x);
  return m && UNIT.test(m[2]) ? { scope: m[1] ?? "system", unit: m[2], port: m[3] ? +m[3] : null } : null;
}).filter(Boolean);
const services = () => Promise.all(units().map(async ({ scope, unit, port }) => {
  const out = await run("systemctl", [...(scope === "user" ? ["--user"] : []), "show", unit, "-p", "ActiveState,SubState,ActiveEnterTimestamp"], 5000);
  const p = Object.fromEntries(out.split("\n").map((l) => l.split(/=(.*)/s)).filter((x) => x[1] !== undefined));
  const t = Date.parse(p.ActiveEnterTimestamp ?? "");
  return { unit, scope, port, active: p.ActiveState === "active", state: `${p.ActiveState ?? "unknown"}/${p.SubState ?? ""}`, since: Number.isNaN(t) ? null : t };
}));
// cloudflared ingress: lines "- hostname: x" + "service: y" (no YAML dependency)
const tunnel = () => {
  const f = process.env.AGENT_TUNNEL_CFG ?? "/etc/cloudflared/config.yml";
  if (!existsSync(f)) return null;
  const out = []; let host = null;
  for (const l of readFileSync(f, "utf8").split("\n")) {
    const h = /^\s*-?\s*hostname:\s*["']?([^"'\s#]+)/.exec(l), s = /^\s*-?\s*service:\s*["']?([^"'\s#]+)/.exec(l);
    if (h) host = h[1]; else if (s && host) { out.push({ hostname: host, service: s[1] }); host = null; }
  }
  return out;
};
// cron: agent user's crontab + Hermes jobs.json (last run/exit only if the file has it)
const cron = async () => {
  const jobs = [];
  for (const l of (await run("crontab", ["-l"], 5000)).split("\n")) {
    const m = /^\s*(?!#)(@\w+\s+|(?:\S+\s+){5})(.+)$/.exec(l);
    // only the command basename (no VAR=…, args, paths) – args tend to be secret
    if (m) jobs.push({ source: "crontab", name: (m[2].trim().split(/\s+/).find((w) => !/^\w+=/.test(w)) ?? "?").split("/").pop().slice(0, 60), schedule: m[1].trim(), lastRun: null, ok: null });
  }
  const f = process.env.AGENT_CRON_JSON ?? "";
  try {
    const j = JSON.parse(readFileSync(f, "utf8")), a = Array.isArray(j) ? j : j.jobs ?? [];
    for (const x of a) {
      const st = String(x.last_status ?? x.lastStatus ?? x.status ?? "").toLowerCase(), code = x.last_exit ?? x.lastExit ?? x.exit_code;
      const t = Date.parse(x.last_run ?? x.lastRun ?? x.last_run_at ?? "");
      jobs.push({ source: "hermes", name: String(x.name ?? x.id ?? "?").slice(0, 120), schedule: String(x.schedule ?? x.cron ?? "").slice(0, 60), lastRun: Number.isNaN(t) ? null : t,
        ok: typeof code === "number" ? code === 0 : st ? !/fail|error|chyb/.test(st) : null });
    }
  } catch { /* file missing / different shape = crontab only */ }
  return jobs;
};

const ok = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
let acting = false; // only one action at a time
const handle = async (req, res) => {
  const send = (c, j) => { res.writeHead(c, { "Content-Type": "application/json" }); res.end(JSON.stringify(j)); };
  if (!ok((req.headers.authorization ?? "").replace(/^Bearer /, ""), TOKEN)) return send(401, { error: "unauthorized" });
  const u = new URL(req.url ?? "/", "http://x");
  if (req.method === "GET" && u.pathname === "/metrics")
    return send(200, { host: os.hostname(), at: Date.now(), disks: await disks(), cpu: os.loadavg()[0] / os.cpus().length, load: os.loadavg(), mem: meminfo(), up: os.uptime() });
  if (req.method === "GET" && u.pathname === "/top") { const t = await top(u.searchParams.get("path") ?? "/"); return t ? send(200, t) : send(400, { error: "path outside AGENT_PATHS" }); }
  if (req.method === "GET" && u.pathname === "/services") return send(200, await services());
  if (req.method === "GET" && u.pathname === "/tunnel") { const t = tunnel(); return t ? send(200, t) : send(404, { error: "no tunnel configured" }); }
  if (req.method === "GET" && u.pathname === "/cron") return send(200, await cron());
  if (req.method === "POST" && u.pathname === "/act") {
    const a = ACTIONS[u.searchParams.get("name") ?? ""];
    if (!ACT || !a) return send(403, { error: "action not allowed" });
    if (acting) return send(409, { error: "an action is already running" });
    acting = true;
    try {
      const out = await new Promise((ok, no) => execFile(a[0], a[1], { timeout: 300_000, maxBuffer: 1 << 20 }, (e, o) => (e ? no(e) : ok(o)))); // not found / exit ≠ 0 / timeout = error
      return send(200, { out: out.slice(-2000) });
    } catch (e) { console.error("act", a[0], e.message); return send(502, { error: "action failed" }); } finally { acting = false; }
  }
  send(404, { error: "not found" });
};
createServer((req, res) => handle(req, res).catch((e) => { console.error(e); if (!res.headersSent) { res.writeHead(500); } res.end(); }))
  .listen(Number(process.env.AGENT_PORT ?? 9477), process.env.AGENT_HOST ?? "127.0.0.1"); // exposed outside only via tunnel / reverse proxy with TLS
