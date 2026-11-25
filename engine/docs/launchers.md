# BMQOS Local Launchers & Quick Start

This guide explains how to start BMQOS in local mode with a single click or command, and how to install desktop launchers on Linux, macOS, and Windows.

---

## Overview

BMQOS consists of two main services in local mode:
1. **Engine** (running by default on port `3800`): coordinates AI agents, task queues, and APIs.
2. **Panel** (running by default on port `3000`): provides the user-facing control panel and dashboard.

The all-in-one start script (`start:all` / `bmqos start`) automatically:
- Starts the Engine.
- Detects and starts the Panel (if present in sibling directories or configured via environment variable).
- Waits for the services to be healthy.
- Automatically launches your default web browser to the web interface.
- Gracefully shuts down all child processes when terminated (Ctrl+C).

---

## Quick Start via CLI

### Using npm
```bash
npm run start:all
```

### Using the CLI wrapper
```bash
./scripts/bmqos start
```

If the package is installed globally (`npm link` or `npm install -g .`):
```bash
bmqos start
```

### Options & Environment Variables

| Variable / Flag | Default | Description |
|---|---|---|
| `PORT` | `3800` | HTTP port for the BMQOS Engine. |
| `PANEL_PORT` | `3000` | HTTP port for the BMQOS Panel. |
| `BMQOS_PANEL_DIR` | Auto-detected | Path to the BMQOS Panel directory. Looks in `../panel`, `../bmqos`, etc. |
| `NO_BROWSER=1` / `--no-browser` | `0` | Prevent opening the browser automatically. |
| `--engine-only` | `false` | Start the engine only, even if panel directory exists. |

---

## Desktop Launchers

Pre-configured launcher files and official icons are located in the `launchers/` directory:
- `launchers/bmqos.desktop` (Linux)
- `launchers/bmqos.command` (macOS)
- `launchers/bmqos.bat` (Windows)
- `launchers/icons/icon.png` (512x512 PNG icon)
- `launchers/icons/icon.svg` (SVG vector icon)

For convenience, shortcuts are also available directly in the repository root (`bmqos.command`, `bmqos.bat`, `bmqos.desktop`).

---

## Platform Installation Guides

### 1. Linux

#### Automatic Installation (Recommended)
Run the provided installer script from the repository root:
```bash
./launchers/install-desktop.sh
```
This script:
1. Copies the 512x512 panel icon to `~/.local/share/icons/hicolor/512x512/apps/bmqos.png`.
2. Resolves absolute paths for your current repository location.
3. Generates and installs `bmqos.desktop` into `~/.local/share/applications/` (so it appears in GNOME, KDE, XFCE, and application menus).
4. Creates a shortcut on `~/Desktop/` if the directory exists.

#### Manual Installation
1. Copy `launchers/icons/icon.png` to `~/.local/share/icons/bmqos.png`.
2. Copy `launchers/bmqos.desktop` to `~/.local/share/applications/bmqos.desktop`.
3. Edit the `Exec=` path in the `.desktop` file to point to your repository root:
   ```ini
   [Desktop Entry]
   Version=1.0
   Type=Application
   Name=BMQOS
   GenericName=AI Agent Engine & Control Panel
   Comment=Start BMQOS Local Services and Open Web Interface
   Exec=bash -c 'cd "/path/to/bmqos-engine" && npm run start:all'
   Icon=/path/to/bmqos-engine/launchers/icons/icon.png
   Terminal=true
   Categories=Development;Office;
   ```
4. Mark the `.desktop` file as executable:
   ```bash
   chmod +x ~/.local/share/applications/bmqos.desktop
   ```

---

### 2. macOS

#### Running via Finder
1. Ensure the launcher has execute permissions:
   ```bash
   chmod +x launchers/bmqos.command bmqos.command
   ```
2. In Finder, double-click `bmqos.command` (in repo root or `launchers/`).
3. macOS Terminal will open, run `npm run start:all`, and open the browser.

#### Adding to Desktop or Dock
1. In Finder, right-click `bmqos.command` and choose **Make Alias**.
2. Drag the created alias to your **Desktop** or **Dock**.
3. (Optional) Custom icon: Select the alias, press `Cmd + I` (Get Info), open `launchers/icons/icon.png` in Preview, copy (`Cmd + C`), select the small icon in top-left of Get Info window, and paste (`Cmd + V`).

---

### 3. Windows

#### Running via Windows Explorer
1. In Windows Explorer, navigate to the repository directory.
2. Double-click `bmqos.bat` (or `launchers/bmqos.bat`).
3. A Command Prompt window will open, launch both services, and display the web interface in your browser.

#### Creating a Desktop Shortcut with Custom Icon
1. Right-click `bmqos.bat` in Windows Explorer and select **Show more options > Create shortcut** (or **Send to > Desktop (create shortcut)**).
2. Move the shortcut to your Desktop.
3. Right-click the shortcut and select **Properties**.
4. In the **Shortcut** tab, click **Change Icon...**.
5. Browse to `launchers\icons\icon.png` (or convert to `.ico`) and select it.
6. Click **OK**, then **Apply**.
