import "server-only";
import { randomUUID } from "node:crypto";
import { sql } from "./db";

/* Merge PR from the OS. GitHub token only on the server, only repos from OS_ALLOWED_REPOS.
   The server re-verifies everything before merging; the client can't be trusted. */
export interface PrInfo {
  repo: string; n: number; url: string; title: string; head: string; base: string;
  files: number; add: number; del: number; draft: boolean; merged: boolean;
  checks: { ok: boolean; text: string }; judge: { ok: boolean; text: string };
  protectedBase: boolean; allowed: boolean; live: boolean;
  sha: string; sameRepo: boolean;
  blocker: string; // empty = can be merged
}

const PROTECTED = ["main", "master", "v5"];
const HOLD_MS = 1200;
const gh = (): string => process.env.GITHUB_TOKEN ?? "";
export const mergeOn = (): boolean => process.env.GITHUB_MERGE === "1" && !!gh();
const allowedRepos = (): string[] => (process.env.OS_ALLOWED_REPOS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
export const PR_URL = /github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/g;

const api = async <T>(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; j: T | null }> => {
  const res = await fetch(`${process.env.GITHUB_API_URL ?? "https://api.github.com"}${path}`, {
    ...init, cache: "no-store", signal: AbortSignal.timeout(20_000),
    headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(gh() ? { Authorization: `Bearer ${gh()}` } : {}), ...(init?.body ? { "Content-Type": "application/json" } : {}) },
  }).catch(() => null);
  return { ok: !!res?.ok, status: res?.status ?? 0, j: res ? ((await res.json().catch(() => null)) as T | null) : null };
};

interface GPr { title: string; draft: boolean; merged: boolean; state: string; changed_files: number; additions: number; deletions: number; head: { ref: string; sha: string; repo: { full_name: string } | null }; base: { ref: string } }

// green = no run/status failed or is still running; a repo without CI gets "no checks" (doesn't block, Judge is the main gate)
const checksOf = async (repo: string, sha: string): Promise<PrInfo["checks"]> => {
  const [runs, st] = await Promise.all([
    api<{ check_runs: { status: string; conclusion: string | null }[] }>(`/repos/${repo}/commits/${sha}/check-runs?per_page=50`),
    api<{ state: string; total_count: number }>(`/repos/${repo}/commits/${sha}/status`),
  ]);
  const cr = runs.j?.check_runs ?? [];
  const bad = cr.filter((r) => r.status !== "completed" || !["success", "neutral", "skipped"].includes(r.conclusion ?? "")).length + (st.j && st.j.total_count > 0 && st.j.state !== "success" ? 1 : 0);
  const total = cr.length + (st.j?.total_count ?? 0);
  if (!runs.ok && !st.ok) return { ok: false, text: "couldn't load checks" };
  return bad ? { ok: false, text: `${bad} checks failed or still running` } : { ok: true, text: total ? `${total} checks green` : "repo has no automated checks" };
};

// Judge's verdict = the newest comment by the Judge agent that carries a verdict: PASS / APPROVED vs FAIL / REJECTED / CHANGES REQUESTED
// (Czech PROJDE / NEPROJDE / ZAMITNUTO is accepted too). A negative word always wins.
const JUDGE_ID = (): string => process.env.OS_JUDGE_AGENT_ID ?? "";
const NEG = /\bNEPROJDE\b|ZAM[ÍI]TNUTO|\bFAIL(?:ED)?\b|\bREJECTED\b|\bCHANGES REQUESTED\b/i;
const POS = /(?<![A-Za-zÁ-ž])PROJDE\b|\bPASS(?:ED)?\b|\bAPPROVED\b/i;
export const judgeOf = (comments: { body: string; authorAgentId?: string | null }[]): PrInfo["judge"] => {
  const hit = comments.find((c) => c.authorAgentId === JUDGE_ID() && (NEG.test(c.body) || POS.test(c.body)));
  if (!hit) return { ok: false, text: "Judge hasn't decided yet" };
  const ok = POS.test(hit.body) && !NEG.test(hit.body);
  return { ok, text: ok ? "Judge: pass" : "Judge: fail" };
};

export const prInfo = async (repo: string, n: number, judge: PrInfo["judge"]): Promise<PrInfo | null> => {
  const allowed = allowedRepos().includes(repo);
  const r = await api<GPr>(`/repos/${repo}/pulls/${n}`);
  if (!r.j) return null;
  const p = r.j;
  const checks = await checksOf(repo, p.head.sha);
  const protectedBase = PROTECTED.includes(p.base.ref);
  const live = mergeOn();
  const blocker = !allowed ? "repo is not in the allowed list" : p.merged ? "already merged" : p.state !== "open" ? "PR is closed" : p.draft ? "PR is a draft" : !checks.ok ? checks.text : !judge.ok ? judge.text : "";
  return {
    repo, n, url: `https://github.com/${repo}/pull/${n}`, title: p.title, head: p.head.ref, base: p.base.ref,
    files: p.changed_files, add: p.additions, del: p.deletions, draft: p.draft, merged: p.merged, checks, judge,
    protectedBase, allowed, live, blocker, sha: p.head.sha, sameRepo: p.head.repo?.full_name === repo,
  };
};

/* ---------- 1.2s hold: one-time nonce, the server only accepts it after at least 1.2s ---------- */
export const startHold = (repo: string, n: number): string => {
  const id = randomUUID();
  sql().prepare("DELETE FROM nonce WHERE at < ?").run(Date.now() - 300_000);
  sql().prepare("INSERT INTO nonce VALUES (?,?,?)").run(id, Date.now(), `${repo}#${n}`);
  return id;
};

export const doMerge = async (repo: string, n: number, nonce: string, confirm: boolean, judge: PrInfo["judge"]): Promise<{ base: string }> => {
  const row = sql().prepare("DELETE FROM nonce WHERE id = ? RETURNING at, key").get(nonce) as { at: number; key: string } | undefined;
  const age = row ? Date.now() - row.at : 0;
  if (!row || row.key !== `${repo}#${n}` || age < HOLD_MS || age > 120_000) throw new Error("hold is invalid, try again");
  const info = await prInfo(repo, n, judge);
  if (!info) throw new Error("couldn't load the PR");
  if (info.blocker) throw new Error(info.blocker);
  if (info.protectedBase && !confirm) throw new Error(`merging into ${info.base} needs confirmation`);
  const what = `${repo}#${n} ${info.head} → ${info.base}`;
  const m = await api<{ message?: string }>(`/repos/${repo}/pulls/${n}/merge`, { method: "PUT", body: JSON.stringify({ merge_method: "merge", sha: info.sha }) });
  if (!m.ok) throw new Error(`GitHub ${m.status}: ${(m.j?.message ?? "").slice(0, 60)}`);
  // branch cleanup after merge (branch hygiene): only agent branches from the same repo
  if (info.head.startsWith("agent/") && info.sameRepo) await api(`/repos/${repo}/git/refs/heads/${info.head}`, { method: "DELETE" });
  return { base: info.base };
};
