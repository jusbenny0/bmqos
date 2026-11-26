#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, scryptSync } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// BMQOS_ENV_FILE lets tests (or a custom layout) write somewhere other than <repo>/.env
const envPath = () => process.env.BMQOS_ENV_FILE || resolve(ROOT_DIR, ".env");
const ENGINE_DIR = process.env.BMQOS_ENGINE_DIR || resolve(ROOT_DIR, "engine");
const ENV_EXAMPLE_PATH = resolve(ROOT_DIR, ".env.example");

const DEFAULT_AGENTS = [
  { name: "Planner", role: "Plans and assigns work" },
  { name: "Builder", role: "Builds features" },
  { name: "Reviewer", role: "Reviews code and checks quality" },
  { name: "Assistant", role: "Summaries and reports for the owner" },
];

function printHelp() {
  console.log(`
BMQOS Setup Script
Automated and interactive configuration for autonomous AI agents and humans.

Usage:
  npm run setup [options]
  node scripts/setup.mjs [options]
  ./scripts/setup.sh [options]

Options:
  --mode=<local|server>      Deployment target: 'local' (default) or 'server' (VPS/home server)
  --auth=<none|password>     Authentication: 'none' (default, no login) or 'password'
  --password=<secret>        Admin password (if --auth=password; auto-generated if omitted)
  --user=<username>          Admin username (default: 'admin')
  --port=<port>              Port to listen on (default: 3000)
  --host=<host>              Interface to bind (default: 127.0.0.1 safe default for both local and server)
  --origin=<url>             Public origin URL (e.g. https://bmqos.example.com)
  --company=<name>           Company name (default: 'My AI Company')
  --owner=<name>             Owner name (default: 'Admin')
  --accent=<hex>             Accent hex color (default: '#059669')
  --crew-url=<url>           Crew orchestrator API URL (optional)
  --crew-token=<token>       Crew orchestrator API Token (optional)
  --db=<path>                Path to SQLite database (default: 'data/os.db')
  -y, --yes, --non-interactive
                             Run non-interactively with defaults or provided flags
  --skip-providers           Skip AI provider detection / role selection
  -h, --help                 Display this help message

Environment Variables:
  BMQOS_MODE, BMQOS_AUTH, BMQOS_PASSWORD, BMQOS_USER, BMQOS_PORT,
  BMQOS_HOST, BMQOS_ORIGIN, BMQOS_COMPANY, BMQOS_OWNER, BMQOS_ACCENT
`);
}

function parseArgs(args) {
  const options = {
    mode: process.env.BMQOS_MODE || "local",
    auth: process.env.BMQOS_AUTH || "none",
    password: process.env.BMQOS_PASSWORD || "",
    user: process.env.BMQOS_USER || "admin",
    port: process.env.BMQOS_PORT || "3000",
    host: process.env.BMQOS_HOST || "",
    origin: process.env.BMQOS_ORIGIN || "",
    company: process.env.BMQOS_COMPANY || "My AI Company",
    owner: process.env.BMQOS_OWNER || "Admin",
    accent: process.env.BMQOS_ACCENT || "#059669",
    crewUrl: process.env.CREW_API_URL || "",
    crewToken: process.env.CREW_API_TOKEN || "",
    dbPath: process.env.OS_DB || "data/os.db",
    interactive: Boolean(process.stdin.isTTY && !process.env.CI && !process.env.DEBIAN_FRONTEND),
    help: false,
  };

  for (const arg of args) {
    if (arg === "-h" || arg === "--help") {
      options.help = true;
    } else if (arg === "--skip-providers") {
      options.skipProviders = true;
    } else if (arg === "-y" || arg === "--yes" || arg === "--non-interactive") {
      options.interactive = false;
    } else if (arg.startsWith("--mode=")) {
      options.mode = arg.split("=")[1].trim();
    } else if (arg.startsWith("--auth=")) {
      options.auth = arg.split("=")[1].trim();
    } else if (arg.startsWith("--password=")) {
      options.password = arg.split("=")[1];
    } else if (arg.startsWith("--user=")) {
      options.user = arg.split("=")[1].trim();
    } else if (arg.startsWith("--port=")) {
      options.port = arg.split("=")[1].trim();
    } else if (arg.startsWith("--host=")) {
      options.host = arg.split("=")[1].trim();
    } else if (arg.startsWith("--origin=")) {
      options.origin = arg.split("=")[1].trim();
    } else if (arg.startsWith("--company=")) {
      options.company = arg.split("=")[1].trim();
    } else if (arg.startsWith("--owner=")) {
      options.owner = arg.split("=")[1].trim();
    } else if (arg.startsWith("--accent=")) {
      options.accent = arg.split("=")[1].trim();
    } else if (arg.startsWith("--crew-url=")) {
      options.crewUrl = arg.split("=")[1].trim();
    } else if (arg.startsWith("--crew-token=")) {
      options.crewToken = arg.split("=")[1].trim();
    } else if (arg.startsWith("--db=")) {
      options.dbPath = arg.split("=")[1].trim();
    }
  }

  return options;
}

function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32);
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;
}

function updateEnvContent(content, updates) {
  let lines = content.split("\n");
  const handled = new Set();

  lines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      for (const [key, value] of Object.entries(updates)) {
        const regex = new RegExp(`^#\\s*${key}=`);
        if (regex.test(trimmed) && !handled.has(key)) {
          handled.add(key);
          return `${key}=${value}`;
        }
      }
      return line;
    }

    const eqIdx = line.indexOf("=");
    if (eqIdx !== -1) {
      const key = line.slice(0, eqIdx).trim();
      if (key in updates) {
        handled.add(key);
        return `${key}=${updates[key]}`;
      }
    }
    return line;
  });

  for (const [key, value] of Object.entries(updates)) {
    if (!handled.has(key)) {
      lines.push(`${key}=${value}`);
    }
  }

  return lines.join("\n");
}

export function writeConfigToDb(dbFilePath, config) {
  const fullPath = resolve(ROOT_DIR, dbFilePath);
  mkdirSync(dirname(fullPath), { recursive: true });
  const db = new DatabaseSync(fullPath);
  db.exec("CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL);");
  const stmt = db.prepare(
    "INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  );

  stmt.run("company", JSON.stringify(config.company));
  stmt.run("agents", JSON.stringify(config.agents));
  stmt.run("engine", JSON.stringify(config.engine));
  stmt.run("goal", JSON.stringify(config.goal));
  stmt.run("onboarded", JSON.stringify("done"));
  db.close();
}

export async function runSetup(opts) {
  const options = { ...opts };

  let directPublicExposure = false;

  if (options.interactive) {
    const rl = readline.createInterface({ input, output });
    console.log("\n============================================================");
    console.log("             BMQOS Setup Wizard");
    console.log("============================================================\n");

    // 1. Target mode
    console.log("Select deployment target mode:");
    console.log("  [1] Local machine (default, for local development / desktop companion)");
    console.log("  [2] VPS / Home server (always-on server, Docker, remote hosting)");
    const modeAnswer = await rl.question("Choice [1]: ");
    if (modeAnswer.trim() === "2") {
      options.mode = "server";
    } else {
      options.mode = "local";
    }

    // 2. Company & Owner
    const companyAnswer = await rl.question(`Company name [${options.company}]: `);
    if (companyAnswer.trim()) options.company = companyAnswer.trim();

    const ownerAnswer = await rl.question(`Owner name [${options.owner}]: `);
    if (ownerAnswer.trim()) options.owner = ownerAnswer.trim();

    // 3. Internet Exposure
    console.log("\nHow do you plan to expose the app to the internet?");
    console.log("  [1] Localhost / Reverse proxy (Caddy, Nginx) / Private VPN (Tailscale) [Recommended, binds 127.0.0.1]");
    console.log("  [2] Cloudflare Tunnel (cloudflared) [Binds 127.0.0.1]");
    console.log("  [3] Direct public interface [Binds 0.0.0.0 - all network adapters]");
    const exposureAnswer = await rl.question("Choice [1]: ");
    if (exposureAnswer.trim() === "2") {
      const originAnswer = await rl.question("Cloudflare Tunnel hostname (e.g. https://bmqos.example.com): ");
      if (originAnswer.trim()) options.origin = originAnswer.trim();
      options.host = "127.0.0.1";
    } else if (exposureAnswer.trim() === "3") {
      directPublicExposure = true;
      options.host = "0.0.0.0";
      const originAnswer = await rl.question("Public domain / URL (e.g. https://bmqos.example.com): ");
      if (originAnswer.trim()) options.origin = originAnswer.trim();
    } else {
      options.host = "127.0.0.1";
      if (options.mode === "server") {
        const originAnswer = await rl.question("Public domain via reverse proxy (e.g. https://bmqos.example.com, optional): ");
        if (originAnswer.trim()) options.origin = originAnswer.trim();
      }
    }

    // 4. Authentication
    console.log("\nWhich authentication mode do you want?");
    console.log("  [1] No authentication (default, safe behind localhost or private VPN)");
    console.log("  [2] Password login (OS_AUTH=password, recommended if reachable over internet)");
    const authAnswer = await rl.question("Choice [1]: ");
    if (authAnswer.trim() === "2") {
      options.auth = "password";
      const passAnswer = await rl.question("Enter admin password (leave empty to auto-generate): ");
      if (passAnswer.trim()) {
        options.password = passAnswer.trim();
      }
    } else {
      options.auth = "none";
      if (directPublicExposure) {
        console.log("\n[WARNING] You chose direct public exposure (0.0.0.0) with NO authentication!");
        const confirm = await rl.question("Are you sure you want an unauthenticated public instance? (y/N): ");
        if (confirm.trim().toLowerCase() !== "y") {
          console.log("Switching binding interface to safe 127.0.0.1 (localhost/reverse proxy only).");
          options.host = "127.0.0.1";
        }
      }
    }

    rl.close();
  }

  // Safe default: Both local and server default to 127.0.0.1 unless explicitly requested
  if (!options.host) {
    options.host = "127.0.0.1";
  }

  // Security check: Flag 0.0.0.0 without authentication
  const isOpenPublic = (options.host === "0.0.0.0" || options.host === "::") && options.auth !== "password";

  // Handle password generation if password auth was selected but no password was given
  let generatedPassword = null;
  let passwordHash = "";
  if (options.auth === "password") {
    if (!options.password) {
      generatedPassword = randomBytes(12).toString("base64url");
      options.password = generatedPassword;
    }
    passwordHash = hashPassword(options.password);
  }

  // Prepare SQLite configuration (exact match with Onboarding spec)
  const dbConfig = {
    company: {
      name: options.company,
      accent: options.accent || "#059669",
      owner: options.owner,
    },
    agents: DEFAULT_AGENTS,
    engine: {
      mode: options.crewUrl ? "crew" : "demo",
      url: options.crewUrl,
      token: options.crewToken,
    },
    goal: {
      model: "sonnet",
      limit: 0,
      goal: "Operate the company with autonomous AI agents",
      task: "Review daily inbox and orchestrate agent tasks",
    },
  };

  writeConfigToDb(options.dbPath, dbConfig);

  // Prepare session secret (ensure secure 32 bytes)
  const sessionSecret = randomBytes(32).toString("hex");

  // Read or create .env
  let baseEnv = "";
  if (existsSync(envPath())) {
    baseEnv = readFileSync(envPath(), "utf8");
  } else if (existsSync(ENV_EXAMPLE_PATH)) {
    baseEnv = readFileSync(ENV_EXAMPLE_PATH, "utf8");
  }

  const updates = {
    PORT: options.port,
    HOSTNAME: options.host,
    OS_ORIGIN: options.origin,
    OS_AUTH: options.auth === "password" ? "password" : "",
    OS_USER: options.user,
    OS_PASSWORD_HASH: options.auth === "password" ? passwordHash : "",
    OS_SESSION_SECRET: sessionSecret,
  };

  if (options.crewUrl) updates.CREW_API_URL = options.crewUrl;
  if (options.crewToken) updates.CREW_API_TOKEN = options.crewToken;

  const finalEnv = updateEnvContent(baseEnv, updates);
  writeFileSync(envPath(), finalEnv, "utf8");

  // Print Summary Output
  console.log("\n============================================================");
  console.log("             BMQOS Setup Complete!                         ");
  console.log("============================================================");
  console.log(`  Deployment Mode:   ${options.mode === "server" ? "VPS / Home server" : "Local machine"}`);
  console.log(`  Host & Port:       ${options.host}:${options.port}`);
  console.log(`  Public Origin:     ${options.origin || "(none configured)"}`);
  console.log(`  Authentication:    ${options.auth === "password" ? `Password (User: ${options.user})` : "None (open access, default)"}`);
  if (generatedPassword) {
    console.log(`  Generated Password: ${generatedPassword}`);
    console.log("  NOTE: This generated password is displayed ONCE now and never stored in plaintext.");
  }
  console.log(`  Company & Owner:   ${options.company} (Owner: ${options.owner})`);
  console.log(`  Database:          ${options.dbPath} (initial config & team saved)`);
  console.log(`  Environment File:  .env (written)`);
  console.log("============================================================");

  if (isOpenPublic) {
    console.log("\n  ****************************************************************");
    console.log("  [CRITICAL SECURITY WARNING]");
    console.log("  BMQOS is bound to 0.0.0.0 (all network adapters) WITHOUT login!");
    console.log("  Anyone on your local network or the internet who can reach this");
    console.log("  machine on port " + options.port + " will have full administrative access.");
    console.log("  Recommendations:");
    console.log("    1. Bind to 127.0.0.1 (HOSTNAME=127.0.0.1 in .env) and use a reverse");
    console.log("       proxy (Caddy/Nginx) or Cloudflare Tunnel.");
    console.log("    2. Or enable password protection: set OS_AUTH=password in .env");
    console.log("  ****************************************************************\n");
  } else if (options.auth !== "password") {
    console.log("\n  * Security Notice: BMQOS is currently configured WITHOUT authentication.");
    console.log("    Because it is bound to 127.0.0.1, it is safe for local desktop use or");
    console.log("    access via private mesh networks (Tailscale / WireGuard).");
    console.log("    If exposing this instance publicly over the internet, enable password login:");
    console.log("      npm run hash -- 'your-secure-password'");
    console.log("      and set OS_AUTH=password in .env\n");
  }

  if (options.mode === "server") {
    console.log("  * Internet Exposure Guide (VPS / Home server):");
    console.log("    1. VPN Mesh (Recommended): Use Tailscale (tailscale up) to access port 3000 securely without exposing ports.");
    console.log("    2. Reverse Proxy: Use Caddy or Nginx with Let's Encrypt SSL proxying to 127.0.0.1:3000.");
    console.log("    3. Cloudflare Tunnel: Run 'cloudflared tunnel' routing your domain directly to localhost:3000.");
  }

  console.log("  * To start BMQOS:");
  console.log("    Development mode:  npm run dev");
  console.log("    Production build:  npm run build && npm start");
  console.log("    Docker Compose:    docker compose up -d\n");

  return {
    mode: options.mode,
    auth: options.auth,
    host: options.host,
    port: options.port,
    origin: options.origin,
    user: options.user,
    company: options.company,
    owner: options.owner,
    dbPath: options.dbPath,
    generatedPassword,
    isOpenPublic,
  };
}

const GROUP_LABELS = {
  planning: "planning (CEO)", building: "building (builders)", junior: "cheap junior", checks: "checks (reviewer/security/QA/visual)",
};

// Detect AI services, let the user pick one per role group (or take the best with interactive=false), write engine roles.
export async function runProviderSetup({ interactive = false, engineDir = ENGINE_DIR, detectOpts } = {}) {
  const P = await import("../engine/lib/providers.ts");
  const { DEFAULT_TEAM } = await import("../engine/lib/config.ts");
  const found = await P.detect(detectOpts);
  console.log("\nDetected AI services:");
  for (const p of found) {
    const note = P.supportNote(p);
    console.log(`  ${p.available ? "[x]" : "[ ]"} ${p.id.padEnd(15)} ${p.kind.padEnd(17)} ${p.detail}${note ? ` (${note})` : ""}`);
  }
  const choice = P.plan(found);
  if (interactive) {
    const usable = found.filter(P.isSupported).map((p) => p.id);
    const rl = readline.createInterface({ input, output });
    for (const g of Object.keys(choice)) {
      if (usable.length < 2) break;
      const a = (await rl.question(`Use for ${GROUP_LABELS[g]}? [${usable.join("/")}] (default ${choice[g]}): `)).trim();
      if (usable.includes(a)) choice[g] = a;
    }
    rl.close();
  }
  for (const g of Object.keys(choice)) console.log(`  ${GROUP_LABELS[g]}: ${choice[g]}`);
  if (choice.planning === "mock") console.log("  No supported provider found: roles run in mock mode (install and log in to the claude CLI).");
  const file = P.write(engineDir, P.buildRoles(DEFAULT_TEAM, choice));
  console.log(`  Roles written to ${file} (CREW_ROLES_FILE in engine/.env)`);
  return { found, choice, file };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    process.exit(0);
  }
  runSetup(options).then(() => (options.skipProviders ? null : runProviderSetup({ interactive: options.interactive }))).catch((err) => {
    console.error("Setup failed:", err);
    process.exit(1);
  });
}
