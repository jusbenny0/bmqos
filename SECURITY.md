# Security Policy

The BMQOS team takes security, privacy, and operator safety seriously. BMQOS orchestrates AI agents capable of performing infrastructure, deployment, and financial operations. This document outlines our security model, supported versions, and procedure for reporting vulnerabilities.

---

## 1. Supported Versions

Security fixes and patches are applied to the active release branch:

| Version | Supported | Status |
| :--- | :--- | :--- |
| `main` (Latest) | :white_check_mark: | Actively supported |
| Older releases | :x: | Upgrade to latest |

---

## 2. Reporting a Vulnerability

**Please do NOT report security vulnerabilities through public GitHub issues.**

If you discover a potential security vulnerability in BMQOS, report it responsibly via one of the following channels:

1. **GitHub Private Security Advisory:** Open an advisory draft under the Security tab of the repository (`https://github.com/jusbenny0/bmqos/security/advisories/new`).
2. **Security Contact:** Email security details to `security@example.com` (or submit a private disclosure through the repository maintainer profile).

### What to Include in Your Report
- A clear description of the vulnerability and potential impact.
- Step-by-step reproduction instructions or a minimal Proof of Concept (PoC).
- Affected version, deployment mode (local, server, Docker), and environment details.
- Any suggested mitigations or patches.

### Response Timeline
- **Initial Acknowledgment:** Within 48 hours.
- **Triage & Status Update:** Within 5 business days.
- **Remediation & Advisory Release:** Coordinated with the reporter after testing a fix.

---

## 3. Core Security Principles & Architecture

BMQOS implements defense-in-depth security to protect operator environments:

### A. Fail-Closed by Default
Any mutation or external action fails closed when authentication or authorization is missing. If backend integration flags such as `OS_CONTROL=1` or write permission flags are not explicitly enabled, operations only create local drafts or return `403 Forbidden` (`{ draft: true }`).

### B. Three-Tier Action Guard
State mutations must pass through the guard barrier (`lib/guard.ts`):
- **Tier 1 (Reversible):** Chat queries, saving drafts, routine tasks.
- **Tier 2 (Risky):** Modifying deployments, code merges, sensitive approval cards, and documentation editing. Requires a valid session and an active step-up window (within 10 minutes of TOTP verification).
- **Tier 3 (Irreversible):** Permanent storage purges or destructive actions. Requires fresh TOTP re-authentication and explicitly re-typing the target resource name.

### C. Automatic Sensitive Card Escalation
Inbound approval cards from the Assistant are analyzed for keywords relating to credentials (`token`, `heslo`, `secret`, `2fa`), finances (`platba`, `usd`, `eur`, `rozpocet`), or production release (`produkce`, `publikovat`). Cards matching sensitive patterns are automatically escalated to Tier 2 and require 2FA approval.

### D. Private Network & LAN Validation
- By default, BMQOS binds to `127.0.0.1`.
- Inbound webhooks from agents (`/api/cards`) verify RFC 1918 private loopback address ranges and reject requests forwarded across public CDNs.
- Shared webhook secrets (`OS_CARDS_KEY`) require a minimum of 16 characters and are validated using constant-time cryptographic comparison (`timingSafeEqual`) to prevent timing side-channel attacks.

### E. Sensitive Data Scrubbing
Passwords, bearer tokens, API credentials, and session identifiers are scrubbed from inbox content, timeline transcripts, and audit logs using redaction utilities (`lib/inbox.ts:scrub` and `lib/redact.ts`) before being committed to SQLite or sent to the browser.

### F. Immutable Audit Log
All sensitive operations, denials, and configuration changes are recorded to the SQLite audit log (`lib/audit.ts`) with SHA-256 hash chaining to ensure tamper-evident records.
