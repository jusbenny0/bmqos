# BMQOS – desktop app (Linux, Tauri 2)

A thin native wrapper around the OS web app: the window loads `OS_URL`, plus a tray icon with the "needs you" count,
native notifications, a global shortcut, and autostart. No second UI – just an offline/settings screen.

## Installation
- **.deb:** `sudo apt install ./BMQOS_0.1.0_amd64.deb` (run `bmqos`)
- **AppImage:** `chmod +x BMQOS_0.1.0_amd64.AppImage && ./BMQOS_0.1.0_amd64.AppImage`

On GNOME you need the "AppIndicator and KStatusNotifierItem Support" extension, otherwise you won't see the tray icon.

## Settings
- **OS address:** defaults to `http://localhost:3000`. To change it: tray → "Address and shortcut…", or `OS_URL=http://127.0.0.1:3300 bmqos`
  (the env var only applies to that run). Saved to `~/.config/bmqos/config.json` (just the address, shortcut, interval – no passwords).
- **Shortcut:** defaults to `Super+K`; change it on the same screen (e.g. `Ctrl+Alt+Space`). Shows the window and focuses the command bar.
  On Wayland global shortcuts depend on the compositor – if it doesn't work, bind the shortcut in the system to the `bmqos` command (the single-instance window will show).
- **Autostart:** on by default on first run (starts hidden in the tray); turn it off via the tray menu "Start on login".
- **Badge poll interval:** `poll_secs` in config.json (10–600s, default 30).

## Behavior
- Closing the window hides it in the tray; quitting only via tray → Quit. A second launch just shows the window.
- The session cookie stays in the persistent webview profile (`~/.local/share/io.github.bmqos`); the app never sees the password.
- Navigation is allowed only to the OS address; other links open in the system browser.
- Server not responding → a dedicated "Retry" screen + an address field.
- Tray badge = the "needs you" count from `/api/items?tab=na-mne` (same number as the Tasks badge in the OS). Needs attention (item type hori) = highlighted icon. Notifications only on a new "needs you" item; clicking opens Home (`OS_URL/`).
- Tray menu: Open · Inbox (`/#inbox`) · Message the Assistant (`/#hermes`) · Stop all (pauses running agents via `/api/act`, with confirmation, requires `OS_CONTROL=1` on the server).

## Development
```sh
. ~/.cargo/env
cd desktop
cargo clippy --all-targets -- -D warnings && cargo test
cargo tauri build          # → target/release/bundle/{deb,appimage}
OS_URL=http://127.0.0.1:3399 cargo run
```
Build requires `libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev patchelf` and `cargo install tauri-cli --version '^2'`.
