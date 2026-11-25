#!/usr/bin/env bash
set -e

# Installer for BMQOS Desktop Launcher on Linux

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ICON_FILE="$SCRIPT_DIR/icons/icon.png"

TARGET_DIR="${1:-$HOME/.local/share/applications}"
DESKTOP_DIR="$HOME/Desktop"

mkdir -p "$TARGET_DIR"

# Install icon into local user icons directory if possible
USER_ICONS_DIR="$HOME/.local/share/icons/hicolor/512x512/apps"
mkdir -p "$USER_ICONS_DIR"
if [ -f "$ICON_FILE" ]; then
    cp "$ICON_FILE" "$USER_ICONS_DIR/bmqos.png"
    RESOLVED_ICON="$USER_ICONS_DIR/bmqos.png"
else
    RESOLVED_ICON="utilities-terminal"
fi

DESKTOP_FILE="$TARGET_DIR/bmqos.desktop"

cat <<EOF > "$DESKTOP_FILE"
[Desktop Entry]
Version=1.0
Type=Application
Name=BMQOS
GenericName=AI Agent Engine & Control Panel
Comment=Start BMQOS Local Services and Open Web Interface
Exec=bash -c 'cd "$ENGINE_DIR" && npm run start:all'
Icon=$RESOLVED_ICON
Terminal=true
Categories=Development;Office;Utility;
Keywords=ai;agent;bmqos;engine;
StartupNotify=true
EOF

chmod +x "$DESKTOP_FILE"
echo "Installed desktop launcher to: $DESKTOP_FILE"

# If ~/Desktop exists, offer or place shortcut there too
if [ -d "$DESKTOP_DIR" ] && [ "$TARGET_DIR" != "$DESKTOP_DIR" ]; then
    cp "$DESKTOP_FILE" "$DESKTOP_DIR/bmqos.desktop"
    chmod +x "$DESKTOP_DIR/bmqos.desktop"
    echo "Also placed shortcut on Desktop: $DESKTOP_DIR/bmqos.desktop"
fi

if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
fi

echo "Done! You can now start BMQOS from your application menu or desktop shortcut."
