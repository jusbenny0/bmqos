use serde::{Deserialize, Serialize};
use std::path::PathBuf;

pub const DEFAULT_URL: &str = "http://localhost:3000";
pub const DEFAULT_SHORTCUT: &str = "Super+K";

/// Saved configuration. Nothing secret - the session cookie lives only in the webview profile.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(default)]
pub struct Config {
    pub os_url: String,
    pub shortcut: String,
    pub poll_secs: u64,
    pub autostart_initialized: bool,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            os_url: DEFAULT_URL.into(),
            shortcut: DEFAULT_SHORTCUT.into(),
            poll_secs: 30,
            autostart_initialized: false,
        }
    }
}

/// Accepts only an http(s) address; adds a scheme, drops path/query/hash and a trailing slash.
pub fn normalize_url(raw: &str) -> Option<String> {
    let t = raw.trim();
    if t.is_empty() {
        return None;
    }
    let with_scheme = if t.contains("://") { t.to_string() } else { format!("https://{t}") };
    let u = url::Url::parse(&with_scheme).ok()?;
    if !matches!(u.scheme(), "http" | "https") {
        return None;
    }
    let host = u.host_str()?;
    let port = u.port().map(|p| format!(":{p}")).unwrap_or_default();
    Some(format!("{}://{host}{port}", u.scheme()))
}

pub fn path() -> PathBuf {
    dirs::config_dir().unwrap_or_else(|| PathBuf::from(".")).join("bmqos").join("config.json")
}

/// Loads the config from a file; the `OS_URL` variable takes precedence (only for this run).
pub fn load_from(p: &std::path::Path, env_url: Option<&str>) -> Config {
    let mut c: Config = std::fs::read_to_string(p).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    if let Some(u) = env_url.and_then(normalize_url) {
        c.os_url = u;
    } else if let Some(u) = normalize_url(&c.os_url) {
        c.os_url = u;
    } else {
        c.os_url = DEFAULT_URL.into();
    }
    c.poll_secs = c.poll_secs.clamp(10, 600);
    c
}

pub fn save_to(p: &std::path::Path, c: &Config) -> std::io::Result<()> {
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d)?;
    }
    std::fs::write(p, serde_json::to_string_pretty(c).unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes() {
        assert_eq!(normalize_url("localhost:3000/"), Some("http://localhost:3000".into()));
        assert_eq!(normalize_url(" http://127.0.0.1:3300/x?y#z "), Some("http://127.0.0.1:3300".into()));
        assert_eq!(normalize_url("javascript:alert(1)"), None);
        assert_eq!(normalize_url("file:///etc/passwd"), None);
        assert_eq!(normalize_url(""), None);
    }

    #[test]
    fn load_defaults_env_and_roundtrip() {
        let dir = std::env::temp_dir().join(format!("bmqos-test-{}", std::process::id()));
        let p = dir.join("config.json");
        assert_eq!(load_from(&p, None), Config::default());
        let c = Config { os_url: "http://lan:3300".into(), poll_secs: 5, ..Config::default() };
        save_to(&p, &c).unwrap();
        let l = load_from(&p, None);
        assert_eq!(l.os_url, "http://lan:3300");
        assert_eq!(l.poll_secs, 10);
        assert_eq!(load_from(&p, Some("preview.local:3300")).os_url, "https://preview.local:3300");
        assert_eq!(load_from(&p, Some("ftp://x")).os_url, "http://lan:3300");
        let _ = std::fs::remove_dir_all(dir);
    }
}
