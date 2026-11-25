import "server-only";

/* Dokploy connector, read-only. Without DOKPLOY_URL/TOKEN returns null.
   Verified live: project.all returns, for applications/compose, only { applicationId|composeId, name, applicationStatus|composeStatus } —
   no domains/sourceType/branch/server. Those only live in application.one/compose.one (per-id), so after project.all each
   app/compose must be fetched individually. Env returns only key names, never values. Writing (deploy) is intentionally not here. */
export interface AppRow { id: string; name: string; project: string; status: string; repo: string; branch: string; domains: string[]; envKeys: string[]; kind: "application" | "compose"; machine: string }
export interface DeployRow { id: string; status: string; title: string; at: string }

export const live = (): boolean => !!process.env.DOKPLOY_TOKEN && !!process.env.DOKPLOY_URL;
export const ID = /^[\w-]{3,40}$/;

const get = async <T>(path: string): Promise<T | null> => {
  if (!live()) return null;
  const res = await fetch(`${process.env.DOKPLOY_URL}/api/${path}`, { cache: "no-store", signal: AbortSignal.timeout(20_000), headers: { "x-api-key": process.env.DOKPLOY_TOKEN! } }).catch(() => null);
  return res?.ok ? ((await res.json().catch(() => null)) as T | null) : null;
};

// only variable names; values are discarded right at read time
export const envKeys = (env: string | null | undefined): string[] =>
  (env ?? "").split("\n").map((l) => /^\s*([A-Za-z_][\w.-]*)\s*=/.exec(l)?.[1] ?? "").filter(Boolean);

/* Shape of project.all (overview only): projects have environments[], each environment has applications/compose with just id, name and status.
   The full shape is in application.one/compose.one: GitHub source = owner/repository/branch, custom git = customGitUrl/customGitBranch,
   gitlab/gitea/bitbucket keep the branch elsewhere → repo stays "" (can't be verified on GitHub), docker/drop has no branch at all. */
interface DAppStub { applicationId?: string; composeId?: string; name: string; applicationStatus?: string; composeStatus?: string }
interface DEnvStub { applications?: DAppStub[]; compose?: DAppStub[] }
interface DProjStub { name: string; environments?: DEnvStub[] }
interface DApp {
  applicationId?: string; composeId?: string; name: string; applicationStatus?: string; composeStatus?: string; sourceType?: string;
  owner?: string | null; repository?: string | null; branch?: string | null; customGitUrl?: string | null; customGitBranch?: string | null;
  gitlabBranch?: string | null; giteaBranch?: string | null; bitbucketBranch?: string | null;
  env?: string | null; domains?: { host: string }[]; server?: { name?: string } | null;
}

// "https://github.com/o/r.git" | "git@github.com:o/r.git" → "o/r"; another host → ""
export const githubRepo = (url: string | null | undefined): string => /github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(url ?? "")?.[1] ?? "";

export const source = (a: DApp): { repo: string; branch: string } => {
  const t = a.sourceType;
  if (t === "git") return { repo: githubRepo(a.customGitUrl), branch: a.customGitBranch ?? "" };
  if (t === "gitlab") return { repo: "", branch: a.gitlabBranch ?? "" };
  if (t === "gitea") return { repo: "", branch: a.giteaBranch ?? "" };
  if (t === "bitbucket") return { repo: "", branch: a.bitbucketBranch ?? "" };
  if (t === "docker" || t === "drop") return { repo: "", branch: "" };
  return { repo: a.owner && a.repository ? `${a.owner}/${a.repository}` : githubRepo(a.customGitUrl), branch: a.branch ?? a.customGitBranch ?? "" };
};

export const apps = async (): Promise<AppRow[] | null> => {
  const p = await get<DProjStub[]>("project.all");
  if (!p) return null;
  const stubs = p.flatMap((x) => (x.environments ?? []).flatMap((e) => [
    ...(e.applications ?? []).map((a) => ({ project: x.name, kind: "application" as const, id: a.applicationId ?? "", name: a.name, status: a.applicationStatus ?? "" })),
    ...(e.compose ?? []).map((a) => ({ project: x.name, kind: "compose" as const, id: a.composeId ?? "", name: a.name, status: a.composeStatus ?? "" })),
  ])).filter((s) => s.id);
  const rows = await Promise.all(stubs.map(async (s): Promise<AppRow | null> => {
    const full = await get<DApp>(s.kind === "compose" ? `compose.one?composeId=${encodeURIComponent(s.id)}` : `application.one?applicationId=${encodeURIComponent(s.id)}`);
    if (!full) return { id: s.id, name: s.name, project: s.project, status: s.status, repo: "", branch: "", domains: [], envKeys: [], kind: s.kind, machine: "" };
    return {
      id: s.id, name: s.name, project: s.project, status: s.status, ...source(full),
      domains: (full.domains ?? []).map((d) => d.host.toLowerCase()), envKeys: envKeys(full.env), kind: s.kind, machine: full.server?.name ?? "",
    };
  }));
  return rows.filter((r): r is AppRow => r !== null);
};

export const deploys = async (id: string, kind: AppRow["kind"] = "application"): Promise<DeployRow[] | null> => {
  if (!ID.test(id)) return null;
  const r = await get<{ deploymentId: string; status: string; title: string; createdAt: string }[]>(kind === "compose" ? `deployment.allByCompose?composeId=${encodeURIComponent(id)}` : `deployment.all?applicationId=${encodeURIComponent(id)}`);
  return r && r.slice(0, 20).map((d) => ({ id: d.deploymentId, status: d.status, title: d.title ?? "", at: d.createdAt }));
};
