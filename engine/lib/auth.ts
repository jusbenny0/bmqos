// Web Crypto: works in middleware (edge) and in route handlers.
export const COOKIE = "crew_session";
const MAX_AGE_S = 60 * 60 * 24 * 30;

function secret(): string {
  // CREW_SESSION_SECRET may differ from CREW_PASSWORD (rotating the password then does not invalidate the signing secret).
  return process.env.CREW_SESSION_SECRET || process.env.CREW_PASSWORD || "";
}

async function hmac(data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

// Signed session with an expiry and a random nonce, not a static password hash (which would be
// identical for every login and would never expire before the cookie's maxAge).
export async function newSession(): Promise<string> {
  if (!secret()) return "";
  const exp = Date.now() + MAX_AGE_S * 1000;
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => b.toString(16).padStart(2, "0")).join("");
  const payload = `${exp}.${nonce}`;
  return `${payload}.${await hmac(payload)}`;
}

export async function checkSession(token: string | undefined): Promise<boolean> {
  if (!token || !secret()) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [expStr, nonce, sig] = parts;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const want = await hmac(`${expStr}.${nonce}`);
  if (want.length !== sig.length) return false;
  let d = 0;
  for (let i = 0; i < want.length; i++) d |= want.charCodeAt(i) ^ sig.charCodeAt(i);
  return d === 0;
}

export async function checkPassword(input: string): Promise<boolean> {
  const pw = process.env.CREW_PASSWORD ?? "";
  if (!pw) return false;
  // compare HMACs so the time does not depend on where the strings differ
  const [x, y] = await Promise.all([hmac(`pw:${input}`), hmac(`pw:${pw}`)]);
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return d === 0;
}

export const SESSION_MAX_AGE_S = MAX_AGE_S;
