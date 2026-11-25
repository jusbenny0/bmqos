import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFile, type ChildProcess } from "node:child_process";

// Evidence for review roles: reviewers should judge a running commit, not the builder's claims. After a passing
// gate the runtime saves the build log, starts `next start` from the worktree on its own port, records the HTTP
// status of the changed pages and screenshots them with headless Chrome at 1440 and 390. Review roles get the file
// paths and the preview URL. Best-effort: an error never breaks the pipeline. Disable with CREW_EVIDENCE=0.

const evidenceDir = () => process.env.CREW_EVIDENCE_DIR || path.join(process.cwd(), "data", "evidence");
const PORT_BASE = Number(process.env.CREW_EVIDENCE_PORT_BASE) || 4600;
const TTL_MS = 90 * 60_000;
const WIDTHS: [number, number][] = [[1440, 900], [390, 844]];

const g = globalThis as unknown as { __crewPrev?: Map<number, ChildProcess> };
const servers = (g.__crewPrev ??= new Map());

function chrome(): string | null {
  if (process.env.CREW_CHROME && fs.existsSync(process.env.CREW_CHROME)) return process.env.CREW_CHROME;
  const base = path.join(process.env.HOME || os.homedir(), ".cache", "ms-playwright");
  try {
    for (const d of fs.readdirSync(base).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse()) {
      const p = path.join(base, d, "chrome-linux64", "chrome");
      if (fs.existsSync(p)) return p;
    }
  } catch { /* no playwright cache */ }
  return null;
}

const run = (cmd: string, args: string[], cwd: string, timeout: number) =>
  new Promise<string>((resolve) =>
    execFile(cmd, args, { cwd, timeout, maxBuffer: 10_000_000 }, (_e, out) => resolve(out || "")));

// app/(group)/foo/page.tsx -> /foo ; dynamic segments ([slug]) are skipped
export function routesFromFiles(files: string[]): string[] {
  const out = new Set<string>(["/"]);
  for (const f of files) {
    const m = f.match(/^(?:src\/)?app\/(.*?)\/?page\.(?:tsx|ts|jsx|js|mdx)$/);
    if (!m) continue;
    const segs = m[1].split("/").filter((s) => s && !/^\(.*\)$/.test(s) && !s.startsWith("@"));
    if (segs.some((s) => s.startsWith("["))) continue;
    out.add("/" + segs.join("/"));
  }
  return [...out].slice(0, 5);
}

export function stopPreview(taskId: number) {
  const p = servers.get(taskId);
  if (!p) return;
  servers.delete(taskId);
  try { if (p.pid) process.kill(-p.pid, "SIGTERM"); } catch { /* already gone */ }
}

async function waitUp(url: string, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(3000) }); return true; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

export async function collectEvidence(taskId: number, cwd: string, base: string, buildLog: string): Promise<string> {
  if (process.env.CREW_EVIDENCE === "0") return "";
  const dir = path.join(evidenceDir(), `task-${taskId}`);
  const lines: string[] = [];
  if (!fs.existsSync(path.join(cwd, "package.json")) || !fs.existsSync(path.join(cwd, ".git"))) return "";
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    if (buildLog) { fs.writeFileSync(path.join(dir, "build.log"), buildLog); lines.push(`build log: ${dir}/build.log`); }
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8")) as { dependencies?: Record<string, string> };
    const nextBin = path.join(cwd, "node_modules", ".bin", "next");
    if (!pkg.dependencies?.next || !fs.existsSync(nextBin) || !fs.existsSync(path.join(cwd, ".next"))) {
      return lines.length ? `Evidence:\n${lines.join("\n")}` : "";
    }
    const files = (await run("git", ["diff", "--name-only", `origin/${base}...HEAD`], cwd, 30_000)).split("\n").filter(Boolean);
    fs.writeFileSync(path.join(dir, "changed-files.txt"), files.join("\n"));
    const routes = routesFromFiles(files);
    stopPreview(taskId);
    const port = PORT_BASE + (taskId % 200);
    const p = spawn(nextBin, ["start", "-p", String(port), "-H", "127.0.0.1"], {
      cwd, detached: true, stdio: "ignore",
      env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: "production" } as unknown as NodeJS.ProcessEnv,
    });
    p.unref();
    servers.set(taskId, p);
    setTimeout(() => stopPreview(taskId), TTL_MS).unref();
    const url = `http://127.0.0.1:${port}`;
    if (!(await waitUp(url, 45_000))) { lines.push("preview: next start did not come up within 45 s"); return `Evidence:\n${lines.join("\n")}`; }
    lines.push(`preview of this commit: ${url} (until the review ends, max 90 min)`);
    const bin = chrome();
    for (const r of routes) {
      let status = "?";
      try { status = String((await fetch(url + r, { redirect: "manual", signal: AbortSignal.timeout(20_000) })).status); } catch { status = "timeout"; }
      const shots: string[] = [];
      if (bin && /^[23]/.test(status)) {
        for (const [w, h] of WIDTHS) {
          const file = path.join(dir, `${r === "/" ? "home" : r.slice(1).replace(/\//g, "_")}-${w}.png`);
          await run(bin, ["--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars", `--window-size=${w},${h}`,
            "--virtual-time-budget=8000", `--screenshot=${file}`, url + r], cwd, 60_000);
          if (fs.existsSync(file)) shots.push(file);
        }
      }
      lines.push(`${r} → HTTP ${status}${shots.length ? `; screenshots: ${shots.join(", ")}` : ""}`);
    }
    return `Evidence (collected by the runtime - view screenshots with the Read tool, open the preview with Playwright):\n${lines.join("\n")}`;
  } catch (e) {
    lines.push(`evidence collection failed: ${(e as Error).message.slice(0, 160)}`);
    return `Evidence:\n${lines.join("\n")}`;
  }
}
