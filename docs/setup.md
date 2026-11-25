# BMQOS Installation and Setup Guide

This guide covers installing and configuring **BMQOS** for autonomous AI agents and human administrators.

---

## 1. Fast Track (Automated Setup)

When giving your AI agent the GitHub repository URL (`https://github.com/jusbenny0/bmqos.git`), the agent can run:

```bash
git clone https://github.com/jusbenny0/bmqos.git
cd bmqos
npm run setup
# or: ./scripts/setup.sh
```

The setup script handles:
- Dependency installation (`npm ci` / `npm install` check)
- Initial database configuration (`data/os.db`) with company profile and default agent roles
- Environment configuration (`.env`)
- Target deployment mode configuration
- Internet exposure and authentication prompts

---

## 2. Deployment Target Modes

BMQOS supports two operational environments:

### A. Local Machine (Default)
- **Use Case:** Local desktop development, testing, or running with the Tauri desktop companion.
- **Network Interface:** `127.0.0.1` (localhost only).
- **Default Authentication:** **Disabled** (no login required for localhost).
- **Public URL (`OS_ORIGIN`):** Optional / `http://localhost:3000`.

### B. VPS / Home Server
- **Use Case:** Always-on remote server, home homelab, or cloud VM running 24/7.
- **Network Interface:** Default `127.0.0.1` (safe default intended for reverse proxy, Tailscale, or Cloudflare Tunnel). Can bind to `0.0.0.0` if direct adapter access is needed.
- **Security Guardrail:** If bound to `0.0.0.0` without password authentication, the setup script prints a critical security warning and requires explicit confirmation in interactive mode.
- **Authentication:** Supported with password (`OS_AUTH=password`) or disabled if kept behind a private mesh VPN (e.g. Tailscale).
- **Public URL (`OS_ORIGIN`):** Recommended when running behind HTTPS reverse proxy (e.g., `https://bmqos.example.com`).

---

## 3. Internet Exposure & Security

BMQOS provides control over agentic workflows. When deploying outside localhost, choose one of these access patterns:

### Option 1: Tailscale / WireGuard (Recommended)
- **Safest option:** Keep `OS_AUTH=` (no password needed) and bind to `127.0.0.1` or your private Tailscale network.
- No public ports need to be exposed to the internet.
- Only devices authenticated to your private tailnet can reach BMQOS.

### Option 2: Reverse Proxy with SSL (Caddy / Nginx / Traefik)
- BMQOS binds safely to `127.0.0.1:3000`.
- The reverse proxy terminates TLS and proxies requests from your domain (e.g. `https://bmqos.example.com`).
- **Always set `OS_AUTH=password`** to protect the instance when publicly accessible.
- Configure `OS_ORIGIN=https://bmqos.example.com` in `.env` to enable secure cookies and redirects.

Example Caddyfile:
```caddy
bmqos.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

### Option 3: Cloudflare Tunnel (cloudflared)
- BMQOS binds safely to `127.0.0.1:3000`.
- Route traffic through an encrypted outbound tunnel to Cloudflare Edge (`cloudflared tunnel run`).
- Set `OS_ORIGIN=https://bmqos.example.com` and enable `OS_AUTH=password` or Cloudflare Zero Trust Access.

---

## 4. Non-Interactive CLI Options (For Agents & CI)

AI agents can execute non-interactive setups by passing command-line arguments or environment variables:

```bash
# Non-interactive local setup with defaults (safe localhost, no auth)
npm run setup -- --non-interactive --mode=local

# Non-interactive VPS setup with password protection behind reverse proxy
npm run setup -- --non-interactive \
  --mode=server \
  --auth=password \
  --password="your-secure-password" \
  --user="admin" \
  --origin="https://bmqos.example.com" \
  --company="Acme AI" \
  --owner="Jane Doe"
```

> **Security Note on Generated Passwords:**
> When `--auth=password` is specified without `--password`, a secure random password is generated and printed **once** to stdout. The plain password is never stored in the database or files; only the salted scrypt hash is written to `.env`.

### Supported CLI Flags

| Flag | Description | Default |
| :--- | :--- | :--- |
| `--mode=<local\|server>` | Deployment environment | `local` |
| `--auth=<none\|password>` | Authentication mode | `none` (default: no password) |
| `--password=<secret>` | Admin password (auto-generated if omitted with `password`) | Generated (one-time stdout) |
| `--user=<username>` | Admin username | `admin` |
| `--port=<port>` | HTTP listening port | `3000` |
| `--host=<host>` | Bind interface | `127.0.0.1` (safe default for local & server) |
| `--origin=<url>` | Public canonical origin URL | None |
| `--company=<name>` | Company name in dashboard | `My AI Company` |
| `--owner=<name>` | Owner / Executive name | `Admin` |
| `--accent=<hex>` | Accent theme color | `#059669` |
| `-y, --yes, --non-interactive` | Run without interactive prompts | `false` |
| `-h, --help` | Display CLI help | |

---

## 5. Starting BMQOS & Verifying Installation

After running setup:

- **Local Development:**
  ```bash
  npm run dev
  ```
- **Production (Standalone):**
  ```bash
  npm run build
  npm start
  ```
- **Docker Compose:**
  ```bash
  docker compose up -d
  ```

### Health Check & Acceptance Test
Verify that the application starts cleanly with your configured database:
```bash
curl -I http://127.0.0.1:3000/
# Returns HTTP 200 (or HTTP 307 redirect to /login if password auth is active)
```
