import "server-only";

/* GitHub connector, read-only. Without GITHUB_TOKEN it returns null (live() = false), nothing throws.
   Token = fine-grained, read-only. Results are cached for GH_TTL_MS (default 60s), successful responses only. */
export interface PrRow { repo: string; n: number; title: string; head: string; base: string; draft: boolean; url: string; updated: string }
export interface BranchRow { name: string; sha: string; protected: boolean }
export interface RunRow { id: number; name: string; branch: string; status: string; conclusion: string; url: string; at: string }

const token = (): string => process.env.GITHUB_TOKEN ?? "";
export const live = (): boolean => !!token();
export const REPO = /^[\w-][\w.-]*\/[\w-][\w.-]*$/;
const allowed = (): string[] => (process.env.OS_ALLOWED_REPOS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
export const isAllowed = (repo: string): boolean => REPO.test(repo) && (allowed().includes(repo) );
export const repos = (): string[] => [...new Set([...allowed(), "your-org/bmqos"])];

const base = (): string => process.env.GITHUB_API_URL ?? "https://api.github.com";
const gh = async <T>(path: string): Promise<{ status: number; j: T | null }> => {
  const r = await fetch(base() + path, {
    cache: "no-store", signal: AbortSignal.timeout(15_000),
    headers: { Authorization: `Bearer ${token()}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
  }).catch(() => null);
  return { status: r?.status ?? 0, j: r?.ok ? ((await r.json().catch(() => null)) as T | null) : null };
};

const cache = new Map<string, { at: number; v: unknown }>();
const cached = async <T>(key: string, fn: () => Promise<T | null>): Promise<T | null> => {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < Number(process.env.GH_TTL_MS ?? 60000)) return hit.v as T;
  const v = await fn();
  if (v !== null) cache.set(key, { at: Date.now(), v });
  return v;
};
const guard = <T>(repo: string, fn: () => Promise<T | null>): Promise<T | null> => (live() && isAllowed(repo) ? fn() : Promise.resolve(null));

export const pulls = (repo: string): Promise<PrRow[] | null> => guard(repo, () => cached(`p:${repo}`, async () => {
  const r = await gh<{ number: number; title: string; draft: boolean; html_url: string; updated_at: string; head: { ref: string }; base: { ref: string } }[]>(`/repos/${repo}/pulls?state=open&per_page=30`);
  return r.j && r.j.map((p) => ({ repo, n: p.number, title: p.title, head: p.head.ref, base: p.base.ref, draft: p.draft, url: p.html_url, updated: p.updated_at }));
}));

export const branches = (repo: string): Promise<BranchRow[] | null> => guard(repo, () => cached(`b:${repo}`, async () => {
  const r = await gh<{ name: string; commit: { sha: string }; protected: boolean }[]>(`/repos/${repo}/branches?per_page=100`);
  return r.j && r.j.map((b) => ({ name: b.name, sha: b.commit.sha.slice(0, 7), protected: b.protected }));
}));

export const runs = (repo: string): Promise<RunRow[] | null> => guard(repo, () => cached(`r:${repo}`, async () => {
  const r = await gh<{ workflow_runs: { id: number; name: string; head_branch: string; status: string; conclusion: string | null; html_url: string; created_at: string }[] }>(`/repos/${repo}/actions/runs?per_page=15`);
  return r.j && r.j.workflow_runs.map((w) => ({ id: w.id, name: w.name, branch: w.head_branch, status: w.status, conclusion: w.conclusion ?? "", url: w.html_url, at: w.created_at }));
}));

/* true/false = certain; null = cannot be determined (no token, network, rate limit) → the watcher must not report a finding */
export const branchExists = (repo: string, branch: string): Promise<boolean | null> => guard(repo, () => cached(`e:${repo}:${branch}`, async () => {
  const r = await gh<unknown>(`/repos/${repo}/branches/${encodeURIComponent(branch)}`);
  return r.status === 200 ? true : r.status === 404 ? false : null;
}));

/* test vs. production: how many commits `head` is ahead of `base` + up to the last 20 (newest first) */
export interface CommitRow { sha: string; message: string; date: string }
export const compare = (repo: string, baseRef: string, head: string): Promise<{ ahead: number; commits: CommitRow[] } | null> => guard(repo, () => cached(`a:${repo}:${baseRef}:${head}`, async () => {
  const r = await gh<{ ahead_by: number; commits: { sha: string; commit: { message: string; committer: { date: string } } }[] }>(`/repos/${repo}/compare/${encodeURIComponent(baseRef)}...${encodeURIComponent(head)}`);
  return r.j && { ahead: r.j.ahead_by, commits: (r.j.commits ?? []).slice(-20).reverse().map((c) => ({ sha: c.sha.slice(0, 7), message: c.commit.message.split("\n")[0], date: c.commit.committer.date })) };
}));

export const commit = (repo: string, ref: string): Promise<{ sha: string; at: string } | null> => guard(repo, () => cached(`c:${repo}:${ref}`, async () => {
  const r = await gh<{ sha: string; commit: { committer: { date: string } } }>(`/repos/${repo}/commits/${encodeURIComponent(ref)}`);
  return r.j && { sha: r.j.sha.slice(0, 7), at: r.j.commit.committer.date };
}));

export const ahead = async (repo: string, baseRef: string, head: string): Promise<number | null> => (await compare(repo, baseRef, head))?.ahead ?? null;
