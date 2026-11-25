import "server-only";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { sql } from "./db";

/* TOTP (RFC 6238, SHA-1, 6 digits, 30 s, ±1 step) with no dependency. The secret lives only in env OS_TOTP_SECRET (base32) or in the file OS_TOTP_SECRET_FILE on the server – never in the DB. */
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const b32 = (b: Buffer): string => { let bits = "", out = ""; for (const x of b) bits += x.toString(2).padStart(8, "0"); for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5).padEnd(5, "0"), 2)]; return out; };
const unb32 = (s: string): Buffer => { let bits = ""; for (const c of s) bits += B32.indexOf(c).toString(2).padStart(5, "0"); return Buffer.from((bits.match(/.{8}/g) ?? []).map((x) => parseInt(x, 2))); };
/** fresh base32 secret + otpauth URI for the setup wizard (the secret goes to .env, never to the DB) */
export const newSecret = (user: string): { secret: string; uri: string } => { const secret = b32(randomBytes(20)); return { secret, uri: `otpauth://totp/BMQOS:${encodeURIComponent(user)}?secret=${secret}&issuer=BMQOS&digits=6&period=30` }; };
// base32 secret from env/file; the file is created on first setup (0600). Error if neither is set.
const secretB32 = (create: boolean): string => {
  const env = (process.env.OS_TOTP_SECRET ?? "").replace(/\s/g, "").toUpperCase();
  if (env) { if (!/^[A-Z2-7]{16,}$/.test(env)) throw new Error("OS_TOTP_SECRET is not valid base32"); return env; }
  const f = process.env.OS_TOTP_SECRET_FILE;
  if (!f) throw new Error("set OS_TOTP_SECRET or OS_TOTP_SECRET_FILE on the server");
  if (existsSync(f)) return readFileSync(f, "utf8").trim().toUpperCase();
  if (!create) throw new Error("secret file doesn't exist");
  const s = b32(randomBytes(20)); mkdirSync(path.dirname(path.resolve(f)), { recursive: true }); writeFileSync(f, s + "\n", { mode: 0o600 });
  return s;
};
const code = (secret: Buffer, step: number): string => {
  const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", secret).update(c).digest(), o = h[19] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000)).padStart(6, "0");
};
const same = (a: string, b: string): boolean => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

interface Row { confirmed: number; last_step: number; backup: string }
const row = (): Row | undefined => sql().prepare("SELECT confirmed, last_step, backup FROM totp WHERE id = 1").get() as Row | undefined;
export const enrolled = (): boolean => row()?.confirmed === 1;

// first-time setup: otpauth is only issued while 2FA isn't confirmed; never after that (reset = manual server action)
export const startEnroll = (): { secret: string; uri: string } => {
  if (enrolled()) throw new Error("2FA is confirmed; reset only on the server (delete the totp row and the secret)");
  const secret = secretB32(true);
  sql().prepare("INSERT INTO totp (id, confirmed, last_step, backup) VALUES (1,0,0,'[]') ON CONFLICT(id) DO UPDATE SET last_step=0, backup='[]'").run();
  const name = encodeURIComponent(process.env.OS_USER ?? "admin");
  return { secret, uri: `otpauth://totp/BMQOS:${name}?secret=${secret}&issuer=BMQOS&digits=6&period=30` };
};

// verifies the code; each step can be used once (replay protection). Also returns true for a backup code (one-time).
export const checkCode = (input: string): boolean => {
  const r = row(); if (!r) return false;
  const c = input.replace(/\s/g, "");
  if (/^\d{6}$/.test(c)) {
    const secret = unb32(secretB32(false)), now = Math.floor(Date.now() / 30_000);
    for (const d of [0, -1, 1]) {
      const step = now + d;
      if (same(code(secret, step), c)) {
        if (step <= r.last_step) return false;
        sql().prepare("UPDATE totp SET last_step = ? WHERE id = 1").run(step);
        return true;
      }
    }
    return false;
  }
  const hashes = JSON.parse(r.backup) as string[];
  const i = hashes.findIndex((h) => { const [salt, hash] = h.split(":"); return same(scryptSync(c, Buffer.from(salt, "hex"), 16).toString("hex"), hash); });
  if (i < 0) return false;
  hashes.splice(i, 1);
  sql().prepare("UPDATE totp SET backup = ? WHERE id = 1").run(JSON.stringify(hashes));
  return true;
};

// confirms enrollment with the first code; returns 10 backup codes (shown once) or null
export const confirmEnroll = (input: string): string[] | null => {
  if (!row() || enrolled() || !checkCode(input)) return null;
  const codes = Array.from({ length: 10 }, () => randomBytes(5).toString("hex"));
  const hashes = codes.map((c) => { const salt = randomBytes(8); return `${salt.toString("hex")}:${scryptSync(c, salt, 16).toString("hex")}`; });
  sql().prepare("UPDATE totp SET confirmed = 1, backup = ? WHERE id = 1").run(JSON.stringify(hashes));
  return codes;
};
