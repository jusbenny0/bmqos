# Installation & Deployment Guide

This guide details the prerequisites, installation methods, and deployment strategies for **BMQOS**.

---

## Prerequisites

- **Node.js:** Node.js 22.x or 24.x LTS (Node.js 24 is recommended).
- **Package Manager:** npm (bundled with Node.js).
- **Operating System:** Linux (Ubuntu 22.04+, Debian 12+, Arch, Fedora), macOS, or Windows (via WSL2).
- **Optional:** Docker and Docker Compose (v2.20+) for containerized deployment.

Verify your Node.js version before proceeding:
```bash
node -v   # Should output v22.x or v24.x
npm -v
```

---

## Deployment Options

Choose the installation method that matches your environment:

| Method | Target | Complexity | Recommended For |
| :--- | :--- | :--- | :--- |
| **1. Automated Setup** | Local / VPS | Low | AI Agents, quickstarts, developers |
| **2. Docker Compose** | VPS / Home Server | Low | Production containers, isolated runs |
| **3. Manual npm Setup** | Local / VPS | Medium | Custom setups, debugging, dev |
| **4. Desktop Companion** | Linux Desktop | Medium | Native desktop window experience |

---

## Method 1: Automated Setup (Recommended)

BMQOS includes an intelligent setup CLI (`scripts/setup.mjs`) that bootstraps database tables, sets up environment variables, and configures deployment parameters interactively or non-interactively.

### Interactive Mode
```bash
git clone https://github.com/jusbenny0/bmqos.git
cd bmqos
npm run setup
# or directly: ./scripts/setup.sh
```

The wizard will guide you through:
1. Selecting deployment target (`Local machine` vs `VPS / Home server`).
2. Setting network binding (`127.0.0.1` vs `0.0.0.0`).
3. Configuring authentication (default: no password on localhost, password for servers).
4. Initializing company profile and default agent roles in SQLite (`data/os.db`).

### Non-Interactive CLI Mode (For Agents & Automation)
You can provide command-line arguments to run without interactive prompts:

```bash
# Safe localhost setup without authentication
npm run setup -- --yes --mode=local

# VPS deployment with password authentication behind reverse proxy
npm run setup -- --yes \
  --mode=server \
  --auth=password \
  --password="your-secure-password" \
  --user="admin" \
  --origin="https://bmqos.example.com" \
  --company="Acme AI Corp" \
  --owner="Chief Operator"
```

Refer to [setup.md](setup.md) for full argument reference.

---

## Method 2: Docker Compose

For containerized deployment with automated volume management:

```bash
# 1. Clone repository
git clone https://github.com/jusbenny0/bmqos.git
cd bmqos

# 2. Configure environment (optional)
cp .env.example .env

# 3. Build and launch the container
docker compose up -d
```

### Docker Features:
- Multi-stage build producing an optimized standalone Next.js container (~120 MB Alpine image).
- Persistent data volume mounted at `/app/data` to preserve the SQLite database across restarts.
- Listens on port `3000` (customizable via `PORT` variable).

Check container logs:
```bash
docker compose logs -f
```

Stop container:
```bash
docker compose down
```

---

## Method 3: Manual npm Setup

If you prefer step-by-step control:

```bash
# 1. Clone the repository
git clone https://github.com/jusbenny0/bmqos.git
cd bmqos

# 2. Install dependencies
npm ci

# 3. Create configuration file
cp .env.example .env

# 4. Generate password hash (optional, if enabling password login)
npm run hash -- 'your-admin-password'
# Set OS_AUTH=password, OS_PASSWORD_HASH, and OS_SESSION_SECRET in .env

# 5. Build and run
# Development:
npm run dev

# Or Production:
npm run build
npm start
```

---

## Method 4: Desktop Companion (Tauri 2 Linux)

BMQOS includes a native Linux desktop companion built with Tauri 2 (Rust) located in `desktop/`.

### Prerequisites for Desktop:
- Rust & Cargo (1.78+)
- WebKit2GTK development libraries:
  ```bash
  sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev libappindicator3-dev
  ```

### Running the Desktop App:
```bash
cd desktop
cargo run
```

---

## Verifying Your Installation

Once BMQOS is running, verify application health via HTTP:

```bash
# Check root endpoint
curl -I http://127.0.0.1:3000/
```
- In **open access mode (`OS_AUTH=none` or empty):** Returns `HTTP/1.1 200 OK`.
- In **password mode (`OS_AUTH=password`):** Returns `HTTP/1.1 307 Temporary Redirect` to `/login`.

Run automated checks:
```bash
# Verify unit tests
npm test

# Verify type safety
npm run typecheck
```

---

## Production Deployment Best Practices

### 1. Bind to Loopback (`127.0.0.1`)
Never expose BMQOS directly on `0.0.0.0` without authentication or TLS. Always bind to `127.0.0.1` and place a reverse proxy or secure tunnel in front.

### 2. Tailscale / Private VPN Mesh (Recommended)
The simplest and most secure remote access method:
1. Run BMQOS on `127.0.0.1:3000` on your home server or VPS.
2. Connect the machine to your private Tailscale network (`tailscale up`).
3. Serve securely via Tailscale Serve:
   ```bash
   tailscale serve http://127.0.0.1:3000
   ```
4. Access BMQOS from your laptop or phone anywhere on your tailnet without exposing public ports.

### 3. Reverse Proxy with SSL (Caddy / Nginx)
When exposing to a public domain:
- Always set `OS_AUTH=password` and generate a 32+ character `OS_SESSION_SECRET`.
- Set `OS_ORIGIN=https://bmqos.example.com` to enforce secure cookie handling.

Example Caddy configuration:
```caddy
bmqos.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Example Nginx configuration:
```nginx
server {
    server_name bmqos.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
