// behind a reverse proxy (Traefik) req.url is the internal address; we build the public one from headers
// OS_ORIGIN (e.g. http://localhost:3000) takes priority: behind the Cloudflare tunnel Traefik reports x-forwarded-proto=http even when the browser used https
const fixed = (): string | undefined => process.env.OS_ORIGIN?.replace(/\/$/, "") || undefined;
export const isHttps = (req: Request): boolean => fixed()?.startsWith("https://") ?? req.headers.get("x-forwarded-proto") === "https";
// the browser came in over http even though the public address is https (Cloudflare sends the real scheme in cf-visitor)
export const plainHttp = (req: Request): boolean => !!fixed()?.startsWith("https://") && /"scheme":"http"/.test(req.headers.get("cf-visitor") ?? "");
export const to = (req: Request, path: string): URL => {
  const o = fixed();
  if (o) return new URL(path, o);
  const h = req.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  return new URL(path, `${h.get("x-forwarded-proto") ?? "http"}://${host}`);
};

// CSRF: writes may only come from a page on the same origin
export const sameOrigin = (req: Request): boolean => {
  const origin = req.headers.get("origin"), host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const o = fixed();
  if (o) return origin === o;
  return !!origin && new URL(origin).host === host;
};
