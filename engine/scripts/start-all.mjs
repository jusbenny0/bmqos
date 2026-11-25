#!/usr/bin/env node

/**
 * BMQOS Local All-in-One Startup Script
 *
 * Starts the BMQOS Engine (port 3800 default) and the BMQOS Panel (port 3000 default if found),
 * then opens the browser automatically to the local web interface.
 */

import { spawn, execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const engineDir = path.resolve(__dirname, '..');

// CLI options
const args = process.argv.slice(2);
const isEngineOnly = args.includes('--engine-only');
const noBrowser = args.includes('--no-browser') || process.env.NO_BROWSER === '1' || process.env.OPEN_BROWSER === '0';

// Configuration
const enginePort = process.env.PORT || '3800';
const panelPort = process.env.PANEL_PORT || '3000';
const engineUrl = `http://localhost:${enginePort}`;
const panelUrl = `http://localhost:${panelPort}`;

// Locate panel repository if available
function findPanelDir() {
  if (isEngineOnly) return null;

  const candidates = [
    process.env.BMQOS_PANEL_DIR,
    path.resolve(engineDir, '..'),
    process.env.PANEL_DIR,
    path.resolve(engineDir, '../panel'),
    path.resolve(engineDir, '../bmqos'),
    path.resolve(engineDir, '../bmqos-panel'),
    path.resolve(engineDir, '../../bmqos'),
    path.resolve(engineDir, './panel')
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const resolved = path.resolve(candidate);
      const pkgPath = path.join(resolved, 'package.json');
      if (fs.existsSync(pkgPath)) {
        return resolved;
      }
    } catch {
      // Ignore invalid paths
    }
  }

  return null;
}

const panelDir = findPanelDir();
const targetBrowserUrl = panelDir ? panelUrl : engineUrl;

console.log('='.repeat(60));
console.log('  BMQOS - Local Mode Launcher');
console.log('='.repeat(60));
console.log(`- Engine directory: ${engineDir}`);
console.log(`- Engine URL:       ${engineUrl}`);

if (panelDir) {
  console.log(`- Panel directory:  ${panelDir}`);
  console.log(`- Panel URL:        ${panelUrl}`);
  console.log(`- Browser target:   ${panelUrl}`);
} else {
  console.log(`- Panel directory:  (not detected - running Engine standalone)`);
  console.log(`- Browser target:   ${engineUrl}`);
}
console.log('='.repeat(60));
console.log('Press Ctrl+C to shut down all BMQOS services.\n');

const isWindows = process.platform === 'win32';
const npmCmd = isWindows ? 'npm.cmd' : 'npm';
const children = [];

function createPrefixedStream(prefix, targetStream) {
  let buffer = '';
  return (data) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (line.trim().length > 0) {
        targetStream.write(`${prefix} ${line}\n`);
      }
    }
  };
}

function spawnService(name, cwd, env, script, extraArgs = []) {
  const child = spawn(npmCmd, ['run', script, ...extraArgs], {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const prefix = `[${name}]`;
  child.stdout.on('data', createPrefixedStream(prefix, process.stdout));
  child.stderr.on('data', createPrefixedStream(prefix, process.stderr));

  child.on('error', (err) => {
    console.error(`[${name}] Failed to start:`, err.message);
  });

  child.on('close', (code) => {
    if (code !== 0 && code !== null) {
      console.log(`[${name}] Exited with code ${code}`);
    }
  });

  children.push(child);
  return child;
}

// One shared API token for engine + panel (kept in the environment or generated per run)
const apiToken = process.env.CREW_API_TOKEN || crypto.randomBytes(24).toString('hex');

// Start Engine
spawnService('engine', engineDir, { PORT: enginePort, CREW_API_TOKEN: apiToken }, 'dev', ['--', '-p', enginePort]);

// Start Panel if present
if (panelDir) {
  spawnService('panel', panelDir, {
    PORT: panelPort,
    CREW_API_URL: engineUrl,
    CREW_API_TOKEN: apiToken
  }, 'dev', ['--', '-p', panelPort]);
}

// Function to open browser
function openBrowser(url) {
  if (noBrowser) {
    console.log(`[bmqos] Auto-browser disabled. Access UI at: ${url}`);
    return;
  }

  console.log(`[bmqos] Opening browser at ${url}...`);

  let cmd;
  let cmdArgs;

  if (process.platform === 'darwin') {
    cmd = 'open';
    cmdArgs = [url];
  } else if (isWindows) {
    cmd = 'cmd.exe';
    cmdArgs = ['/c', 'start', '""', url];
  } else {
    cmd = 'xdg-open';
    cmdArgs = [url];
  }

  try {
    const proc = spawn(cmd, cmdArgs, { stdio: 'ignore', detached: true });
    proc.on('error', () => {
      console.log(`[bmqos] Note: Could not launch browser automatically. Please open: ${url}`);
    });
    proc.unref();
  } catch {
    console.log(`[bmqos] Note: Please open ${url} in your browser.`);
  }
}

// Wait for target service to become available before launching browser
async function waitForServiceAndOpenBrowser(url) {
  if (noBrowser) return;

  const maxAttempts = 30; // 15 seconds
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(url, { method: 'HEAD' }).catch(() => null);
      if (res && res.status < 500) {
        openBrowser(url);
        return;
      }
    } catch {
      // Continue waiting
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  // Fallback if HEAD check didn't succeed within timeout
  openBrowser(url);
}

waitForServiceAndOpenBrowser(targetBrowserUrl);

// Graceful shutdown handling
let isShuttingDown = false;
function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n[bmqos] Received ${signal || 'exit'}, terminating services...`);

  for (const child of children) {
    if (!child.killed) {
      if (isWindows && child.pid) {
        try {
          execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' });
        } catch {
          child.kill('SIGTERM');
        }
      } else {
        child.kill('SIGTERM');
      }
    }
  }

  setTimeout(() => {
    process.exit(0);
  }, 1000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGHUP', () => shutdown('SIGHUP'));
