# Security Architecture & Threat Model

BMQOS is built to act as the executive control plane for autonomous AI agents that have real-world operational capabilities (creating pull requests, deploying software, spending money, or touching infrastructure).

This document details the security principles, threat model, and defense mechanisms implemented in BMQOS.

---

## 1. Threat Model & Design Assumptions

BMQOS assumes the following operating environment:
- **Agents are autonomous:** AI agents may propose destructive or high-cost actions, or become confused. The human operator must remain the ultimate authority for sensitive decisions.
- **Network Boundaries:** In standard deployments, BMQOS runs on an operator's local machine or a private home server / homelab.
- **Attack Vectors Considered:**
  1. Unauthorized public internet access to an unauthenticated instance.
  2. Forged cross-origin requests (CSRF) from malicious websites.
  3. Accidental execution of unvetted or high-impact agent proposals.
  4. Credential and token leakage in UI logs or unified inbox items.
  5. Timing attacks against webhook secrets.

---

## 2. Authentication & Session Management

BMQOS offers two distinct authentication profiles:

### A. Open Access (Local & Private Mesh)
- **Setting:** `OS_AUTH=""` (or omitted).
- **Use Case:** Local developer machine (`127.0.0.1`) or inside an encrypted mesh VPN (Tailscale, WireGuard).
- **Behavior:** No login form is presented. Requests immediately access the dashboard without credentials.

### B. Password & Multi-Factor Authentication
- **Setting:** `OS_AUTH=password` (or when `OS_PASSWORD_HASH` is defined).
- **Password Storage:** Uses scrypt with a unique 16-byte random salt and 32-byte key:
  ```
  scrypt:<hex_salt>:<hex_hash>
  ```
- **Session Tokens:** Signed with HMAC-SHA256 using `OS_SESSION_SECRET` (at least 32 characters). Sessions are stored in the SQLite `sessions` table and validated on each request.
- **Two-Factor Authentication (TOTP):** Base32 secret stored in `OS_TOTP_SECRET` or an external file with `0600` permissions (`OS_TOTP_SECRET_FILE`). Generates standard 6-digit RFC 6238 codes.

---

## 3. The Three-Tier Action Guard

All state changes and external operations must pass through `guarded()` in `lib/guard.ts`. Actions are classified into three strict tiers:

```
[ Incoming Action Request ]
            |
            v
   Valid Session & CSRF? ----(No)----> 403 Forbidden
            | (Yes)
            v
      Check Tier Level
            |
     +------+------+
     |             |             |
   Tier 1        Tier 2        Tier 3
(Reversible)    (Risky)     (Irreversible)
     |             |             |
  Session      Step-up 2FA    Fresh 2FA
  Required     (10m Window)   + Typed Target
     |             |             |
     +------+------+-------------+
            |
            v
    Opt-in Flag Active? ----(No)----> 403 { draft: true }
    (e.g. OS_CONTROL=1)               (Save draft only)
            | (Yes)
            v
   [ Execute Operation ]
```

### Tier Classifications:
1. **Tier 1 (Reversible Writes):**
   - Operations: `chat.send`, `chat.approval`, `voice.draft`, `card.answer`, `social.write`, `inbox.answer`, `item.write`, `task.create`.
   - Requires: Valid session, same-origin check.
2. **Tier 2 (Risky Operations):**
   - Operations: `control.act`, `card.answer.sensitive`, `merge.pr`, `docs.edit`, `session.revokeOthers`.
   - Requires: Valid session + step-up 2FA code verified within the past 10 minutes.
3. **Tier 3 (Irreversible Operations):**
   - Operations: `storage.tidy` (purging agent directories or persistent databases).
   - Requires: Valid session + brand new TOTP code + explicitly typing the exact target identifier.

---

## 4. Webhook Security & LAN Verification

AI agents submit questions to the operator via `POST /api/cards`. This endpoint is fortified against unauthorized or internet-based injection:

### A. IP Range Validation (`isLan`)
Requests are verified to originate from private RFC 1918, RFC 4193, or loopback IP ranges:
- `127.0.0.0/8`, `::1` (Loopback)
- `10.0.0.0/8`
- `172.16.0.0/12`
- `192.168.0.0/16`
- `fc00::/7`, `fe80::/10` (IPv6 ULA & Link-Local)

### B. Cloudflare Bypass Prevention
If the request contains the `cf-connecting-ip` header, it is recognized as having arrived through a public Cloudflare CDN route and is immediately rejected.

### C. Constant-Time Key Verification
The webhook authorization header (`Bearer <key>`) is validated against `OS_CARDS_KEY` using Node.js `timingSafeEqual`:
```typescript
const a = Buffer.from(got), b = Buffer.from(k);
return a.length === b.length && timingSafeEqual(a, b);
```
This prevents timing analysis attacks that could deduce the key character-by-character.

---

## 5. Automatic Sensitive Keyword Escalation

When an agent creates an approval card, the card type determines whether the operator must supply 2FA to answer:
- **Standard Types:** `hori` (urgent), `smer` (direction), `obsah` (content) -> **Tier 1**.
- **Sensitive Types:** `klic` (keys/credentials), `penize` (finances), `verejne` (public releases) -> **Tier 2**.

To prevent an agent or caller from bypassing 2FA by misclassifying a request as non-sensitive, incoming text is automatically evaluated against security regex patterns:
- **Credentials:** `/\b(klic|token|heslo|api.?key|secret|2fa|credential)/i` -> Promoted to `klic`.
- **Finances:** `/platb|zaplat|faktur|\d\s*(kc|czk|eur|usd)\b|predplatn|rozpocet/i` -> Promoted to `penize`.
- **Public Release:** `/na ostro|produkc|zverejn|publikov|vydat\b/i` -> Promoted to `verejne`.

Cards can only be **escalated** to sensitive status, never downgraded.

---

## 6. Secret Redaction & Scrubbing

BMQOS continuously scrubs credentials from in-memory objects before storing them to SQLite or rendering them in the web UI:
- **Bearer Tokens:** Any `Bearer <token>` string is redacted to `Bearer [hidden]`.
- **Passwords & Keys:** Strings matching `password: ...` or known token formats are masked with `[hidden]`.
- **Environment Isolation:** Secrets defined in `.env` (such as sensitive API tokens) are strictly scoped to server modules (`server-only`) and never included in client-side bundles.

---

## 7. Tamper-Evident Audit Log

State-changing actions generate an entry in the SQLite `audit` table containing:
- UTC timestamp
- Actor username
- Client IP address and User-Agent
- Action identifier and Tier level
- Target identifier and sanitized parameters
- Execution result (`intent`, `ok`, `failed`, or `denied`)
- **Cryptographic SHA-256 Hash Chain:** Each log record computes its hash over the current payload combined with the hash of the preceding entry, making retrofitted tampering immediately detectable.
