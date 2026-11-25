#!/usr/bin/env bash
# BMQOS macOS One-Click Launcher
# Double-click this file in macOS Finder to start BMQOS and open your browser.

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR" || exit 1

echo "========================================="
echo " Starting BMQOS Local Services"
echo "========================================="
echo "Engine directory: $DIR"
echo ""

npm run start:all

echo ""
echo "BMQOS services stopped."
read -n 1 -s -r -p "Press any key to close this terminal window..."
echo ""
