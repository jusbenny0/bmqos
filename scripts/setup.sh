#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# Check Node.js
if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js is not installed. Please install Node.js (v22 or v24 recommended)." >&2
  exit 1
fi

NODE_MAJOR=$(node -v | cut -d'.' -f1 | tr -d 'v')
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "Warning: Node.js version $NODE_MAJOR detected. BMQOS requires Node.js 22 or 24." >&2
fi

# Install dependencies if node_modules is missing
if [ ! -d "node_modules" ]; then
  echo "Dependencies not found. Installing..."
  if [ -f "package-lock.json" ]; then
    npm ci
  else
    npm install
  fi
fi

# Run the node setup script with all arguments forwarded
exec node scripts/setup.mjs "$@"
