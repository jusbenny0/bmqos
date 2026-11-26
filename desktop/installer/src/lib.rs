//! Pure installer logic (no I/O besides small fs helpers) so it can be unit-tested with `cargo test`.
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const REPO_URL: &str = "https://github.com/jusbenny0/bmqos.git";
pub const MIN_NODE_MAJOR: u32 = 22;

/// `v22.5.1` / `22.5.1\n` -> 22
pub fn parse_node_major(out: &str) -> Option<u32> {
    out.trim().trim_start_matches('v').split('.').next()?.parse().ok()
}

pub fn node_ok(out: &str) -> bool {
    parse_node_major(out).is_some_and(|m| m >= MIN_NODE_MAJOR)
}

#[derive(Serialize, Deserialize, Debug, Default, PartialEq)]
pub struct EnvReport {
    pub node: Option<String>,
    pub node_ok: bool,
    pub git: Option<String>,
    pub claude: Option<String>,
    pub claude_logged_in: bool,
}

impl EnvReport {
    /// Node and git are required; claude CLI is optional (engine falls back to mock roles).
    pub fn ready(&self) -> bool {
        self.node_ok && self.git.is_some()
    }
}

pub fn env_report(node: Option<String>, git: Option<String>, claude: Option<String>, claude_logged_in: bool) -> EnvReport {
    let node = node.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    EnvReport {
        node_ok: node.as_deref().is_some_and(node_ok),
        node,
        git: git.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()),
        claude: claude.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()),
        claude_logged_in,
    }
}

/// Mirrors engine/lib/providers.ts: ~/.claude/.credentials.json counts as logged in (else the caller tries `claude auth status`).
pub fn claude_credentials_exist(home: &Path) -> bool {
    home.join(".claude").join(".credentials.json").exists()
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct Config {
    pub dir: String,
    pub company: String,
    pub owner: String,
    pub port: u16,
    #[serde(default)]
    pub choice: serde_json::Map<String, serde_json::Value>,
    #[serde(default)]
    pub personas: serde_json::Map<String, serde_json::Value>,
    #[serde(default)]
    pub playbook: Option<String>,
}

fn clean(s: &str, what: &str) -> Result<String, String> {
    let s = s.trim();
    if s.is_empty() || s.starts_with('-') || s.chars().any(|c| c.is_control()) {
        return Err(format!("invalid {what}"));
    }
    Ok(s.to_string())
}

/// Arguments for `node scripts/setup.mjs` (non-interactive, local mode; providers are applied separately via bridge.mjs).
pub fn setup_args(c: &Config) -> Result<Vec<String>, String> {
    if c.port < 1024 {
        return Err("port must be 1024-65535".into());
    }
    Ok(vec![
        "scripts/setup.mjs".into(),
        "--yes".into(),
        "--mode=local".into(),
        "--skip-providers".into(),
        format!("--company={}", clean(&c.company, "company")?),
        format!("--owner={}", clean(&c.owner, "owner")?),
        format!("--port={}", c.port),
    ])
}

/// JSON for `node bridge.mjs apply`.
pub fn bridge_selection(c: &Config) -> String {
    serde_json::json!({ "choice": c.choice, "personas": c.personas, "playbook": c.playbook }).to_string()
}

#[derive(Debug, PartialEq)]
pub struct Step {
    pub label: &'static str,
    pub prog: &'static str,
    pub args: Vec<String>,
    /// Run inside the repo dir (false = run next to it, for the initial clone).
    pub in_repo: bool,
}

/// Clone (unless the dir already holds a checkout), then install panel + engine dependencies.
pub fn install_steps(repo_exists: bool, dir: &str) -> Vec<Step> {
    let mut v = Vec::new();
    if !repo_exists {
        v.push(Step { label: "Downloading BMQOS", prog: "git", args: vec!["clone".into(), "--depth=1".into(), REPO_URL.into(), dir.into()], in_repo: false });
    }
    v.push(Step { label: "Installing panel dependencies", prog: "npm", args: vec!["ci".into()], in_repo: true });
    v.push(Step { label: "Installing engine dependencies", prog: "npm", args: vec!["run".into(), "engine:install".into()], in_repo: true });
    v
}

#[derive(Debug, PartialEq)]
pub struct ShortcutFile {
    pub path: PathBuf,
    pub content: String,
    pub executable: bool,
}

/// Desktop launcher for `npm run start:all`. `os` is `std::env::consts::OS`.
pub fn shortcut_files(os: &str, home: &Path, repo: &Path) -> Vec<ShortcutFile> {
    let desktop = home.join("Desktop");
    let repo_s = repo.display();
    match os {
        "windows" => vec![ShortcutFile {
            path: desktop.join("BMQOS.cmd"),
            content: format!("@echo off\r\ncd /d \"{repo_s}\"\r\nnpm run start:all\r\n"),
            executable: false,
        }],
        "macos" => vec![ShortcutFile {
            path: desktop.join("BMQOS.command"),
            content: format!("#!/bin/bash\ncd \"{repo_s}\" && npm run start:all\n"),
            executable: true,
        }],
        _ => {
            let entry = format!(
                "[Desktop Entry]\nType=Application\nName=BMQOS\nComment=Start BMQOS\nExec=sh -c 'cd \"{repo_s}\" && npm run start:all'\nTerminal=true\nCategories=Utility;\n"
            );
            vec![
                ShortcutFile { path: desktop.join("BMQOS.desktop"), content: entry.clone(), executable: true },
                ShortcutFile { path: home.join(".local/share/applications/bmqos.desktop"), content: entry, executable: true },
            ]
        }
    }
}

pub fn write_shortcuts(files: &[ShortcutFile]) -> std::io::Result<()> {
    for f in files {
        if let Some(p) = f.path.parent() {
            std::fs::create_dir_all(p)?;
        }
        std::fs::write(&f.path, &f.content)?;
        #[cfg(unix)]
        if f.executable {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&f.path, std::fs::Permissions::from_mode(0o755))?;
        }
    }
    Ok(())
}

pub fn default_dir(home: &Path) -> String {
    home.join("bmqos").display().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg() -> Config {
        Config { dir: "/x".into(), company: "Acme".into(), owner: "Eva".into(), port: 3000, choice: Default::default(), personas: Default::default(), playbook: None }
    }

    #[test]
    fn node_versions() {
        assert_eq!(parse_node_major("v22.5.1\n"), Some(22));
        assert_eq!(parse_node_major("24.0.0"), Some(24));
        assert_eq!(parse_node_major("garbage"), None);
        assert!(node_ok("v22.0.0") && node_ok("v24.1.0"));
        assert!(!node_ok("v20.11.0") && !node_ok(""));
    }

    #[test]
    fn report_ready_needs_node_and_git_but_not_claude() {
        let r = env_report(Some("v24.0.0\n".into()), Some("git version 2.43".into()), None, false);
        assert!(r.node_ok && r.ready() && r.claude.is_none());
        assert!(!env_report(Some("v18.0.0".into()), Some("git".into()), None, false).ready());
        assert!(!env_report(Some("v24.0.0".into()), Some("  ".into()), None, false).ready());
        assert!(!env_report(None, Some("git".into()), None, false).ready());
    }

    #[test]
    fn credentials_detection() {
        let d = std::env::temp_dir().join(format!("bmqos-inst-{}", std::process::id()));
        std::fs::create_dir_all(d.join(".claude")).unwrap();
        assert!(!claude_credentials_exist(&d));
        std::fs::write(d.join(".claude/.credentials.json"), "{}").unwrap();
        assert!(claude_credentials_exist(&d));
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn setup_args_ok_and_validated() {
        let a = setup_args(&cfg()).unwrap();
        assert!(a.contains(&"--company=Acme".to_string()) && a.contains(&"--port=3000".to_string()) && a.contains(&"--skip-providers".to_string()));
        let mut c = cfg();
        c.company = "--evil".into();
        assert!(setup_args(&c).is_err());
        c.company = "a\nb".into();
        assert!(setup_args(&c).is_err());
        c = cfg();
        c.port = 80;
        assert!(setup_args(&c).is_err());
        c = cfg();
        c.owner = "  ".into();
        assert!(setup_args(&c).is_err());
    }

    #[test]
    fn bridge_json() {
        let mut c = cfg();
        c.choice.insert("planning".into(), "claude".into());
        c.playbook = Some("feature".into());
        let v: serde_json::Value = serde_json::from_str(&bridge_selection(&c)).unwrap();
        assert_eq!(v["choice"]["planning"], "claude");
        assert_eq!(v["playbook"], "feature");
    }

    #[test]
    fn steps_skip_clone_for_existing_checkout() {
        let s = install_steps(false, "/x");
        assert_eq!(s.len(), 3);
        assert_eq!(s[0].prog, "git");
        assert!(!s[0].in_repo && s[0].args.contains(&REPO_URL.to_string()));
        let s = install_steps(true, "/x");
        assert_eq!(s.len(), 2);
        assert!(s.iter().all(|x| x.prog == "npm" && x.in_repo));
    }

    #[test]
    fn shortcuts_per_os() {
        let (h, r) = (Path::new("/h"), Path::new("/h/bmqos"));
        let l = shortcut_files("linux", h, r);
        assert_eq!(l.len(), 2);
        assert!(l[0].content.contains("Exec=sh -c 'cd \"/h/bmqos\" && npm run start:all'") && l[0].executable);
        let w = shortcut_files("windows", h, r);
        assert!(w[0].path.ends_with("BMQOS.cmd") && w[0].content.contains("\r\n") && !w[0].executable);
        let m = shortcut_files("macos", h, r);
        assert!(m[0].path.ends_with("BMQOS.command") && m[0].content.starts_with("#!/bin/bash") && m[0].executable);
    }

    #[test]
    fn writes_shortcut_files() {
        let d = std::env::temp_dir().join(format!("bmqos-sc-{}", std::process::id()));
        let f = shortcut_files("linux", &d, &d.join("bmqos"));
        write_shortcuts(&f).unwrap();
        assert!(d.join("Desktop/BMQOS.desktop").exists());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(d.join("Desktop/BMQOS.desktop")).unwrap().permissions().mode() & 0o111, 0o111);
        }
        std::fs::remove_dir_all(&d).unwrap();
    }
}
