/* Real company projects (not projects from Paperclip). A task belongs to a project by title or by the Paperclip project name; everything else is grouped under Paperclip. */
export interface Real { n: string; re: RegExp; url: string }
// Configure your products with OS_PROJECTS = JSON [{"n":"Shop","re":"shop|store","url":"https://shop.example.com"}].
// Without it the demo shows two sample products.
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const fromEnv = (): Real[] | null => {
  try {
    const raw = JSON.parse(process.env.OS_PROJECTS ?? "null") as { n: string; re?: string; url?: string }[] | null;
    return Array.isArray(raw) ? raw.filter((p) => p?.n).map((p) => ({ n: p.n, re: new RegExp(p.re || esc(p.n), "i"), url: p.url ?? "" })) : null;
  } catch { return null; }
};
export const REAL: Real[] = fromEnv() ?? [
  { n: "Acme Storefront", re: /acme|storefront|\bshop\b|csv export|payment/i, url: "https://example.com" },
  { n: "Mobile App", re: /mobile|\bapp\b|push notif|staging/i, url: "https://example.com/app" },
];
/* Previews awaiting approval (LAN preview, static list); `project` = name from REAL. A project with no preview doesn't trigger the "ready to test" push. */
export const PREVIEWS: { project: string; name: string; url: string }[] = [
  { project: "BMQOS", name: "BMQOS preview", url: "http://127.0.0.1:3201" },
];
export const realOf = (title: string, paperclipProject: string): Real | undefined => REAL.find((r) => r.re.test(title) || r.re.test(paperclipProject));

/* Project environments: addresses from env URL_<KEY> (production above), URL_<KEY>_TEST, URL_<KEY>_PREVIEW; repo from REPO_<KEY> (otherwise from Dokploy by domain).
   Key = uppercase name with no spaces. Matching with services is a pure function `envsOf` (no network). */
export type EnvKind = "prod" | "test" | "preview";
export interface EnvSvc { domain: string | null; up: boolean; ms: number | null; certDays: number | null; version: { branch: string; commit: string | null; at: string | null } | null }
export interface Env { kind: EnvKind; url: string; branch: string | null; commit: string | null; at: string | null; health: "ok" | "down" | "unknown"; ms: number | null; certDays: number | null }
export const slug = (n: string): string => n.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const key = (n: string): string => n.toUpperCase().replace(/[^A-Z0-9]/g, "");
export const envUrls = (r: Real): Record<EnvKind, string> => ({
  prod: r.url, test: process.env[`URL_${key(r.n)}_TEST`] ?? "", preview: process.env[`URL_${key(r.n)}_PREVIEW`] ?? "",
});
export const repoOf = (r: Real): string => process.env[`REPO_${key(r.n)}`] ?? (r.n === "BMQOS" ? "your-org/bmqos" : "");
const host = (u: string): string => { try { return new URL(u).hostname.toLowerCase(); } catch { return ""; } };
/* service for the address: domain match; nothing is guessed (no match = health "unknown", no faked version) */
export const envsOf = (r: Real, svcs: EnvSvc[]): Env[] =>
  (Object.entries(envUrls(r)) as [EnvKind, string][]).filter(([, url]) => url).map(([kind, url]) => {
    const h = host(url), s = h ? svcs.find((x) => x.domain?.toLowerCase() === h) : undefined;
    return {
      kind, url, branch: s?.version?.branch ?? null, commit: s?.version?.commit ?? null, at: s?.version?.at ?? null,
      health: s ? (s.up ? "ok" : "down") : "unknown", ms: s?.ms ?? null, certDays: s?.certDays ?? null,
    };
  });
