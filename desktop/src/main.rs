#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod badge;
mod badge_icon;
mod config;

use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::image::Image;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{TrayIcon, TrayIconBuilder};
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt as _};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_opener::OpenerExt;

const LOCAL: &str = "tauri://localhost/index.html";

struct App {
    cfg: Mutex<config::Config>,
    seen_wait: Mutex<Option<HashSet<String>>>,
    running: Mutex<Vec<String>>,
    label: Mutex<Option<MenuItem<tauri::Wry>>>,
    tray: Mutex<Option<TrayIcon>>,
}
type St<'a> = State<'a, Arc<App>>;

fn os_url(app: &AppHandle) -> String {
    app.state::<Arc<App>>().cfg.lock().unwrap().os_url.clone()
}

fn is_local(u: &url::Url) -> bool {
    u.scheme() == "tauri" || u.host_str() == Some("tauri.localhost") || u.scheme() == "about"
}

fn same_origin(u: &url::Url, base: &str) -> bool {
    url::Url::parse(base).map(|b| b.origin() == u.origin()).unwrap_or(false)
}

fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window("main")
}

fn show(app: &AppHandle) -> Option<WebviewWindow> {
    let w = main_window(app)?;
    let _ = w.show();
    let _ = w.unminimize();
    let _ = w.set_focus();
    Some(w)
}

/// Opens a path in the OS (e.g. `/#inbox`); if the window is currently showing offline/settings, navigation switches it.
fn open_path(app: &AppHandle, path: &str) {
    if let Some(w) = show(app) {
        if let Ok(u) = url::Url::parse(&format!("{}{}", os_url(app), path)) {
            let _ = w.navigate(u);
        }
    }
}

fn open_local(app: &AppHandle, query: &str) {
    if let Some(w) = show(app) {
        if let Ok(u) = url::Url::parse(&format!("{LOCAL}?{query}")) {
            let _ = w.navigate(u);
        }
    }
}

async fn reachable(base: &str) -> Result<(), String> {
    let c = reqwest::Client::builder().timeout(Duration::from_secs(6)).build().map_err(|e| e.to_string())?;
    match c.get(format!("{base}/login")).send().await {
        Ok(r) if r.status().as_u16() < 500 => Ok(()),
        Ok(r) => Err(format!("Server returned {}", r.status().as_u16())),
        Err(_) => Err(format!("Can't connect to {base}.")),
    }
}

fn save_cfg(app: &AppHandle) {
    let c = app.state::<Arc<App>>().cfg.lock().unwrap().clone();
    let _ = config::save_to(&config::path(), &c);
}

// ---- commands for the local page (the remote OS has no IPC access) ----

#[derive(serde::Serialize)]
struct Settings {
    os_url: String,
    shortcut: String,
    autostart: bool,
}

#[tauri::command]
fn get_settings(app: AppHandle, st: St) -> Settings {
    let c = st.cfg.lock().unwrap().clone();
    Settings { os_url: c.os_url, shortcut: c.shortcut, autostart: app.autolaunch().is_enabled().unwrap_or(false) }
}

#[tauri::command]
async fn connect(app: AppHandle, st: St<'_>, url: String) -> Result<(), String> {
    let base = config::normalize_url(&url).ok_or("Invalid address (expected http:// or https://).")?;
    reachable(&base).await?;
    st.cfg.lock().unwrap().os_url = base.clone();
    save_cfg(&app);
    *st.seen_wait.lock().unwrap() = None;
    st.running.lock().unwrap().clear();
    let w = main_window(&app).ok_or("window missing")?;
    w.navigate(url::Url::parse(&base).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_settings(app: AppHandle, st: St, shortcut: String, autostart: bool) -> Result<(), String> {
    let sc = shortcut.trim().to_string();
    register_shortcut(&app, &sc)?;
    st.cfg.lock().unwrap().shortcut = sc;
    save_cfg(&app);
    set_autostart(&app, autostart);
    Ok(())
}

fn set_autostart(app: &AppHandle, on: bool) {
    let m = app.autolaunch();
    let _ = if on { m.enable() } else { m.disable() };
}

// ---- global shortcut ----

fn register_shortcut(app: &AppHandle, sc: &str) -> Result<(), String> {
    let gs = app.global_shortcut();
    let new: tauri_plugin_global_shortcut::Shortcut = sc.parse().map_err(|_| format!("Invalid shortcut \"{sc}\" (e.g. Super+K, Ctrl+Alt+Space)."))?;
    let old = app.state::<Arc<App>>().cfg.lock().unwrap().shortcut.clone();
    let old = old.parse::<tauri_plugin_global_shortcut::Shortcut>().ok().filter(|o| *o != new);
    gs.on_shortcut(new, |app, _, ev| {
        if ev.state() == ShortcutState::Pressed {
            palette(app);
        }
    })
    .map_err(|e| format!("Failed to register shortcut: {e}"))?;
    if let Some(o) = old {
        let _ = gs.unregister(o);
    }
    Ok(())
}

/// Shows the window and focuses the command bar (for now route `/` + focus first field; later `/palette`).
fn palette(app: &AppHandle) {
    let Some(w) = show(app) else { return };
    let base = os_url(app);
    let on_os = w.url().map(|u| same_origin(&u, &base)).unwrap_or(false);
    if !on_os {
        open_path(app, "/");
        return;
    }
    let _ = w.eval("document.querySelector('[data-palette],input,textarea')?.focus()");
}

// ---- tray + poll ----

fn tray_base_icon() -> (Vec<u8>, u32, u32) {
    let img = Image::from_bytes(include_bytes!("../icons/128x128.png")).expect("icon");
    (img.rgba().to_vec(), img.width(), img.height())
}

fn refresh_tray(app: &AppHandle, text: &str, count: usize, hot: bool) {
    let st = app.state::<Arc<App>>();
    if let Some(l) = st.label.lock().unwrap().as_ref() {
        let _ = l.set_text(text);
    }
    if let Some(t) = st.tray.lock().unwrap().as_ref() {
        let (mut px, w, h) = tray_base_icon();
        badge_icon::draw(&mut px, w as usize, count, hot);
        let _ = t.set_icon(Some(Image::new_owned(px, w, h)));
        let _ = t.set_tooltip(Some(text));
    };
}

fn notify(app: &AppHandle, title: &str, body: &str, path: String) {
    let (title, body, app) = (title.to_string(), body.to_string(), app.clone());
    // On Linux the plugin doesn't report notification clicks, so use notify-rust directly (D-Bus "default" action).
    std::thread::spawn(move || {
        let n = notify_rust::Notification::new().appname("BMQOS").summary(&title).body(&body).action("default", "Open").show();
        if let Ok(h) = n {
            h.wait_for_action(|a| {
                if a == "default" || a == "clicked" {
                    open_path(&app, &path);
                }
            });
        }
    });
}

async fn poll_once(app: &AppHandle, client: &reqwest::Client) {
    let base = os_url(app);
    let st = app.state::<Arc<App>>();
    let Some(w) = main_window(app) else { return };
    let Ok(u) = url::Url::parse(&base) else { return };
    let cookies = w.cookies_for_url(u).unwrap_or_default();
    let header = cookies.iter().map(|c| format!("{}={}", c.name(), c.value())).collect::<Vec<_>>().join("; ");
    let res = client.get(format!("{base}/api/items?tab=na-mne")).header("Cookie", header.clone()).send().await;
    let r = match res {
        Ok(r) => r,
        Err(_) => {
            st.running.lock().unwrap().clear();
            return refresh_tray(app, "OS: offline", 0, false);
        }
    };
    if r.status().as_u16() == 401 {
        st.running.lock().unwrap().clear();
        return refresh_tray(app, "OS: log in in the window", 0, false);
    }
    let Some(b) = r.text().await.ok().and_then(|t| badge::parse(&t)) else {
        st.running.lock().unwrap().clear();
        return refresh_tray(app, "OS: unexpected response", 0, false);
    };
    let label = if b.burning { format!("Needs you: {} (urgent)", b.waiting.len()) } else { format!("Needs you: {}", b.waiting.len()) };
    refresh_tray(app, &label, b.waiting.len(), b.burning);
    // running agents, only for "Stop all" (not the badge)
    let snap = client.get(format!("{base}/api/snapshot")).header("Cookie", &header).send().await;
    let running = match snap {
        Ok(r) if r.status().is_success() => r.text().await.map(|t| badge::running(&t)).unwrap_or_default(),
        _ => vec![],
    };
    *st.running.lock().unwrap() = running;
    // the first poll just remembers the state (right after startup we don't flood with notifications)
    let mut sw = st.seen_wait.lock().unwrap();
    let first = sw.is_none();
    let seen = sw.get_or_insert_with(HashSet::new);
    if !first {
        for i in badge::fresh(&b.waiting, seen) {
            notify(app, "Needs you", &i.title, "/".into());
        }
    }
    *seen = b.waiting.iter().map(|i| i.id.clone()).collect();
}

async fn stop_all(app: AppHandle) {
    let ids = app.state::<Arc<App>>().running.lock().unwrap().clone();
    let base = os_url(&app);
    let Some(w) = main_window(&app) else { return };
    let Ok(u) = url::Url::parse(&base) else { return };
    let header = w.cookies_for_url(u).unwrap_or_default().iter().map(|c| format!("{}={}", c.name(), c.value())).collect::<Vec<_>>().join("; ");
    let client = reqwest::Client::builder().timeout(Duration::from_secs(10)).build().unwrap_or_default();
    let mut fail = 0;
    for id in &ids {
        let r = client
            .post(format!("{base}/api/act"))
            .header("Cookie", &header)
            .header("Origin", &base)
            .json(&serde_json::json!({"op": "agent", "id": id, "value": "pause"}))
            .send()
            .await;
        if !r.map(|r| r.status().is_success()).unwrap_or(false) {
            fail += 1;
        }
    }
    let msg = if fail == 0 { format!("Paused agents: {}.", ids.len()) } else { format!("Failed to pause {fail} of {} agents (controls disabled, or not logged in?).", ids.len()) };
    notify(&app, "Stop all", &msg, "/".into());
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let st = app.state::<Arc<App>>();
    let label = MenuItem::with_id(app, "label", "Needs you: –", false, None::<&str>)?;
    let auto = CheckMenuItem::with_id(app, "autostart", "Launch at login", true, app.autolaunch().is_enabled().unwrap_or(false), None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &label,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "open", "Open", true, None::<&str>)?,
            &MenuItem::with_id(app, "inbox", "Inbox", true, None::<&str>)?,
            &MenuItem::with_id(app, "hermes", "Message the Assistant", true, None::<&str>)?,
            &MenuItem::with_id(app, "stop", "Stop all…", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "settings", "Address and shortcut…", true, None::<&str>)?,
            &auto,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?,
        ],
    )?;
    let (px, w, h) = tray_base_icon();
    let tray = TrayIconBuilder::new()
        .icon(Image::new_owned(px, w, h))
        .tooltip("BMQOS")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|t, e| {
            if let tauri::tray::TrayIconEvent::Click { button: tauri::tray::MouseButton::Left, button_state: tauri::tray::MouseButtonState::Up, .. } = e {
                show(t.app_handle());
            }
        })
        .on_menu_event(move |app, e| match e.id.as_ref() {
            "open" => {
                show(app);
            }
            "inbox" => open_path(app, "/#inbox"),
            "hermes" => open_path(app, "/#hermes"),
            "settings" => open_local(app, "settings=1"),
            "autostart" => {
                let on = app.autolaunch().is_enabled().unwrap_or(false);
                set_autostart(app, !on);
                let _ = auto.set_checked(!on);
            }
            "stop" => {
                let app = app.clone();
                std::thread::spawn(move || {
                    let n = app.state::<Arc<App>>().running.lock().unwrap().len();
                    let ok = app
                        .dialog()
                        .message(format!("Pause all running agents ({n})?"))
                        .title("Stop all")
                        .buttons(MessageDialogButtons::OkCancelCustom("Pause".into(), "Cancel".into()))
                        .blocking_show();
                    if ok {
                        tauri::async_runtime::block_on(stop_all(app));
                    }
                });
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    *st.label.lock().unwrap() = Some(label);
    *st.tray.lock().unwrap() = Some(tray);
    Ok(())
}

fn build_window(app: &AppHandle, start_online: bool) -> tauri::Result<()> {
    let base = os_url(app);
    let handle = app.clone();
    let target = if start_online { WebviewUrl::External(url::Url::parse(&base).expect("url")) } else { WebviewUrl::App("index.html?offline=1".into()) };
    WebviewWindowBuilder::new(app, "main", target)
        .title("BMQOS")
        .inner_size(1440.0, 900.0)
        .min_inner_size(900.0, 600.0)
        .on_navigation(move |u| {
            if is_local(u) || same_origin(u, &os_url(&handle)) {
                return true;
            }
            if matches!(u.scheme(), "http" | "https" | "mailto") {
                let _ = handle.opener().open_url(u.as_str(), None::<&str>);
            }
            false
        })
        .build()?;
    Ok(())
}

fn main() {
    let cfg = config::load_from(&config::path(), std::env::var("OS_URL").ok().as_deref());
    let state = Arc::new(App { cfg: Mutex::new(cfg), seen_wait: Mutex::new(None), running: Mutex::new(vec![]), label: Mutex::new(None), tray: Mutex::new(None) });

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            show(app);
        }))
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec!["--hidden"])))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![get_settings, connect, save_settings])
        .on_window_event(|w, e| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = e {
                api.prevent_close();
                let _ = w.hide();
            }
        })
        .setup(|app| {
            let h = app.handle().clone();
            let st = h.state::<Arc<App>>();
            // first launch: enable autostart (can be disabled in the tray menu / settings)
            if !st.cfg.lock().unwrap().autostart_initialized {
                set_autostart(&h, true);
                st.cfg.lock().unwrap().autostart_initialized = true;
                save_cfg(&h);
            }
            let online = tauri::async_runtime::block_on(reachable(&os_url(&h))).is_ok();
            build_window(&h, online)?;
            if std::env::args().any(|a| a == "--hidden") {
                if let Some(w) = main_window(&h) {
                    let _ = w.hide();
                }
            }
            build_tray(&h)?;
            let sc = st.cfg.lock().unwrap().shortcut.clone();
            if let Err(e) = register_shortcut(&h, &sc) {
                eprintln!("{e}");
            }
            tauri::async_runtime::spawn(async move {
                let client = reqwest::Client::builder().timeout(Duration::from_secs(10)).build().expect("client");
                loop {
                    poll_once(&h, &client).await;
                    let s = h.state::<Arc<App>>().cfg.lock().unwrap().poll_secs;
                    tokio::time::sleep(Duration::from_secs(s)).await;
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("startup error");
}
