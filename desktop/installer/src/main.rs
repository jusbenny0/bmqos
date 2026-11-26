// Tauri shell: thin command wrappers around bmqos_installer (logic + tests live in lib.rs).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use bmqos_installer as lib;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use tauri::{async_runtime::spawn_blocking, AppHandle, Emitter};

fn npm() -> &'static str {
    if cfg!(windows) { "npm.cmd" } else { "npm" }
}

fn version(prog: &str) -> Option<String> {
    let out = Command::new(prog).arg("--version").output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn home() -> Result<PathBuf, String> {
    dirs::home_dir().ok_or_else(|| "no home dir".to_string())
}

/// Runs a command, streaming each output line to the UI as a `log` event.
fn run(app: &AppHandle, prog: &str, args: &[String], cwd: &Path) -> Result<(), String> {
    let mut child = Command::new(prog)
        .args(args)
        .current_dir(cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("{prog}: {e}"))?;
    let err = child.stderr.take().map(|s| {
        let app = app.clone();
        std::thread::spawn(move || BufReader::new(s).lines().map_while(Result::ok).for_each(|l| { let _ = app.emit("log", l); }))
    });
    if let Some(out) = child.stdout.take() {
        BufReader::new(out).lines().map_while(Result::ok).for_each(|l| { let _ = app.emit("log", l); });
    }
    if let Some(t) = err { let _ = t.join(); }
    let st = child.wait().map_err(|e| e.to_string())?;
    st.success().then_some(()).ok_or_else(|| format!("{prog} exited with {st}"))
}

fn node_out(repo: &Path, args: &[&str]) -> Result<String, String> {
    let out = Command::new("node").args(args).current_dir(repo).output().map_err(|e| format!("node: {e}"))?;
    if out.status.success() { Ok(String::from_utf8_lossy(&out.stdout).to_string()) } else { Err(String::from_utf8_lossy(&out.stderr).trim().to_string()) }
}

#[tauri::command]
fn default_dir() -> Result<String, String> {
    Ok(lib::default_dir(&home()?))
}

#[tauri::command]
async fn detect_env() -> Result<lib::EnvReport, String> {
    spawn_blocking(|| {
        let claude = version("claude");
        let logged = claude.is_some()
            && (home().map(|h| lib::claude_credentials_exist(&h)).unwrap_or(false)
                || Command::new("claude").args(["auth", "status"]).output().map(|o| o.status.success()).unwrap_or(false));
        lib::env_report(version("node"), version("git"), claude, logged)
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn install(app: AppHandle, dir: String) -> Result<(), String> {
    spawn_blocking(move || {
        let repo = PathBuf::from(&dir);
        for s in lib::install_steps(repo.join("package.json").exists(), &dir) {
            let _ = app.emit("log", format!("== {}", s.label));
            let (prog, cwd) = if s.prog == "npm" { (npm(), repo.clone()) } else { (s.prog, repo.parent().map(Path::to_path_buf).unwrap_or_else(|| PathBuf::from("."))) };
            if !s.in_repo { std::fs::create_dir_all(&cwd).map_err(|e| e.to_string())?; }
            run(&app, prog, &s.args, &cwd)?;
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Provider/persona/playbook catalogue as JSON, produced by the repo's own engine code.
#[tauri::command]
async fn bridge_detect(dir: String) -> Result<String, String> {
    spawn_blocking(move || node_out(Path::new(&dir), &["desktop/installer/bridge.mjs", "detect"])).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn configure(app: AppHandle, config: lib::Config) -> Result<(), String> {
    spawn_blocking(move || {
        let repo = PathBuf::from(&config.dir);
        let mut args = lib::setup_args(&config)?;
        run(&app, "node", &args, &repo)?;
        args = vec!["desktop/installer/bridge.mjs".into(), "apply".into(), lib::bridge_selection(&config)];
        run(&app, "node", &args, &repo)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn finish(dir: String, start: bool) -> Result<String, String> {
    spawn_blocking(move || {
        let repo = PathBuf::from(&dir);
        lib::write_shortcuts(&lib::shortcut_files(std::env::consts::OS, &home()?, &repo)).map_err(|e| e.to_string())?;
        if start {
            Command::new(npm()).args(["run", "start:all"]).current_dir(&repo).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn().map_err(|e| e.to_string())?;
        }
        Ok("Desktop shortcut created.".to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![default_dir, detect_env, install, bridge_detect, configure, finish])
        .run(tauri::generate_context!())
        .expect("error while running installer");
}
