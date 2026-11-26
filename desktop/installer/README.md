# BMQOS Installer

Tauri 2 wizard that sets up BMQOS on a fresh machine. Separate from `desktop/` (the panel companion app).

## Steps

1. **Check** – Node.js ≥ 22, git (required); `claude` CLI + login (optional, otherwise roles run in mock mode).
2. **Install** – `git clone` (skipped if the folder already holds a checkout), `npm ci`, `npm run engine:install`.
3. **AI services** – the catalogue (detected providers, personalities, playbooks) comes from the repo's own code via `bridge.mjs detect`, which imports `engine/lib/providers.ts`, `config.ts` and `playbooks.ts`. Pick a service and personality per role group plus a default playbook.
4. **Configure** – `node scripts/setup.mjs --yes --mode=local --skip-providers ...` writes `.env` and the DB config; then `bridge.mjs apply` calls `runProviderSetup({ selection })` (exported from `setup.mjs`) to write the engine roles, personas and default playbook.
5. **Launch** – optionally runs `npm run start:all` and creates a desktop launcher (`BMQOS.desktop` on Linux, `BMQOS.command` on macOS, `BMQOS.cmd` on Windows).

Logic (version parsing, env report, setup args, install steps, shortcut files) lives in `src/lib.rs` and is unit-tested; `src/main.rs` only wraps it in Tauri commands.

## Develop

```bash
cd desktop/installer
cargo test            # logic tests
cargo tauri dev       # run the wizard
cargo tauri build     # deb + AppImage (+ rpm) on Linux
```

Linux build libs: `libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev patchelf`.

## CI

`.github/workflows/installer.yml` builds on a matrix: Linux (`deb`, `AppImage`), Windows (`nsis` `.exe`), macOS (`dmg`). Artifacts are **unsigned**: Windows SmartScreen and macOS Gatekeeper will warn (macOS: right-click → Open). Only the Linux build was run locally; Windows/macOS run only in CI.

## Not covered

No automatic Node.js/git installation (the wizard tells the user what is missing). The wizard downloads from `https://github.com/jusbenny0/bmqos.git` and installs npm packages; nothing else leaves the machine.
