#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::Serialize;
use std::env;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::thread::sleep;
use std::time::{Duration, UNIX_EPOCH};
use tauri::{
    AppHandle, Manager, PhysicalPosition, PhysicalSize, Url, WebviewUrl, WebviewWindowBuilder,
};

const DISPLAY_WINDOW_LABEL: &str = "customer-display";
const DOCUMENT_PREVIEW_WINDOW_LABEL: &str = "document-preview";
const DISPLAY_IDLE_ROUTE: &str = "/display/idle";
const DEV_DISPLAY_BASE_URL: &str = "http://127.0.0.1:3300";

#[derive(Debug, Serialize, Clone)]
struct MonitorInfo {
    name: String,
    width: u32,
    height: u32,
    x: i32,
    y: i32,
    primary: bool,
}

#[derive(Debug, Serialize, Clone)]
struct DisplayWindowState {
    has_secondary_monitor: bool,
    secondary_monitor: Option<MonitorInfo>,
    active_route: String,
    window_open: bool,
}

#[derive(Debug, Serialize, Clone)]
struct PickedDocumentFile {
    file_name: String,
    data_base64: String,
}

#[derive(Debug, Serialize, Clone)]
struct DesktopRuntimeInfo {
    runtime_mode: String,
    binary_path: String,
    binary_mtime_unix_ms: Option<u128>,
    dev_base_url: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
struct DocumentExportResult {
    path: String,
    mode: String,
}

fn normalize_display_route(route: &str) -> String {
    let trimmed = route.trim();
    if trimmed.is_empty() {
        DISPLAY_IDLE_ROUTE.to_string()
    } else if trimmed.starts_with('/') {
        trimmed.to_string()
    } else {
        format!("/{trimmed}")
    }
}

fn unique_path_for_save(base_path: PathBuf) -> PathBuf {
    if !base_path.exists() {
        return base_path;
    }

    let parent = base_path
        .parent()
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    let stem = base_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("document")
        .to_string();
    let extension = base_path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| format!(".{value}"))
        .unwrap_or_default();

    for index in 2..1000 {
        let candidate = parent.join(format!("{stem} ({index}){extension}"));
        if !candidate.exists() {
            return candidate;
        }
    }

    base_path
}

fn app_window_url(route: &str) -> WebviewUrl {
    let normalized = normalize_display_route(route);
    #[cfg(debug_assertions)]
    {
        WebviewUrl::External(
            format!("{}/#{normalized}", dev_display_base_url())
                .parse()
                .expect("dev url should be valid"),
        )
    }
    #[cfg(not(debug_assertions))]
    {
        WebviewUrl::App(format!("index.html#{normalized}").into())
    }
}

fn display_window_url(route: &str) -> WebviewUrl {
    app_window_url(route)
}

fn app_window_hash_url(route: &str) -> Url {
    let normalized = normalize_display_route(route);
    #[cfg(debug_assertions)]
    {
        Url::parse(&format!("{}/#{normalized}", dev_display_base_url()))
            .expect("dev hash url should be valid")
    }
    #[cfg(all(not(debug_assertions), target_os = "windows"))]
    {
        Url::parse(&format!("http://tauri.localhost/index.html#{normalized}"))
            .expect("windows app hash url should be valid")
    }
    #[cfg(all(not(debug_assertions), not(target_os = "windows")))]
    {
        Url::parse(&format!("tauri://localhost/index.html#{normalized}"))
            .expect("app hash url should be valid")
    }
}

fn navigate_window_to_route(window: &tauri::WebviewWindow, route: &str) -> Result<(), String> {
    window
        .navigate(app_window_hash_url(route))
        .map_err(|error| error.to_string())
}

fn best_effort_navigate_window_to_route(window: &tauri::WebviewWindow, route: &str) {
    if let Err(error) = navigate_window_to_route(window, route) {
        eprintln!("[desktop] window route navigation failed: {error}");
    }
}

fn ensure_window_route_if_needed(
    window: &tauri::WebviewWindow,
    route: &str,
    should_navigate: bool,
) {
    if should_navigate {
        best_effort_navigate_window_to_route(window, route);
    }
}

fn show_customer_display_window(
    window: &tauri::WebviewWindow,
    route: &str,
    secondary_monitor: &MonitorInfo,
    should_navigate: bool,
) -> Result<(), String> {
    ensure_window_route_if_needed(window, route, should_navigate);
    window
        .set_position(PhysicalPosition::new(
            secondary_monitor.x,
            secondary_monitor.y,
        ))
        .map_err(|error| error.to_string())?;
    window
        .set_size(PhysicalSize::new(
            secondary_monitor.width,
            secondary_monitor.height,
        ))
        .map_err(|error| error.to_string())?;
    window
        .set_fullscreen(true)
        .map_err(|error| error.to_string())?;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    Ok(())
}

#[allow(dead_code)]
fn _app_window_hash_url_for_tests(route: &str) -> String {
    app_window_hash_url(route).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_display_routes() {
        assert_eq!(normalize_display_route("display/idle"), "/display/idle");
        assert_eq!(normalize_display_route("/display/token"), "/display/token");
        assert_eq!(normalize_display_route(""), DISPLAY_IDLE_ROUTE);
    }

    #[cfg(not(debug_assertions))]
    #[test]
    fn app_hash_url_uses_supported_release_protocol() {
        let url = _app_window_hash_url_for_tests("/display/idle");
        if cfg!(target_os = "windows") {
            assert_eq!(url, "http://tauri.localhost/index.html#/display/idle");
        } else {
            assert_eq!(url, "tauri://localhost/index.html#/display/idle");
        }
    }
}

fn current_binary_mtime_unix_ms() -> Option<u128> {
    let executable = env::current_exe().ok()?;
    let modified = fs::metadata(executable).ok()?.modified().ok()?;
    modified
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_millis())
}

fn dev_display_base_url() -> String {
    env::var("SEROGULD_DESKTOP_DEV_URL")
        .ok()
        .map(|value| value.trim().trim_end_matches('/').to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEV_DISPLAY_BASE_URL.to_string())
}

fn configure_document_preview_window(
    window: &tauri::WebviewWindow,
    route: &str,
    title: Option<String>,
) -> Result<(), String> {
    if let Some(next_title) = title {
        let _ = window.set_title(&next_title);
    }
    best_effort_navigate_window_to_route(window, route);
    let _ = window.set_size(PhysicalSize::new(1180, 780));
    let _ = window.center();
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    Ok(())
}

fn secondary_monitor_info(app: &AppHandle) -> Result<Option<MonitorInfo>, String> {
    let main_window = app
        .get_webview_window("main")
        .ok_or_else(|| "Ana pencere bulunamadı".to_string())?;
    let monitors = main_window
        .available_monitors()
        .map_err(|error| error.to_string())?;

    if monitors.len() <= 1 {
        return Ok(None);
    }

    let current_monitor = main_window
        .current_monitor()
        .map_err(|error| error.to_string())?;

    let current_position = current_monitor
        .as_ref()
        .map(|monitor| monitor.position().clone())
        .unwrap_or(PhysicalPosition { x: 0, y: 0 });

    let fallback = monitors
        .iter()
        .enumerate()
        .find(|(index, _)| *index > 0)
        .map(|(_, monitor)| monitor.clone());

    let secondary = monitors
        .into_iter()
        .find(|monitor| {
            let position = monitor.position();
            position.x != current_position.x || position.y != current_position.y
        })
        .or(fallback);

    Ok(secondary.map(|monitor| MonitorInfo {
        name: monitor
            .name()
            .cloned()
            .unwrap_or_else(|| "İkinci Ekran".to_string()),
        width: monitor.size().width,
        height: monitor.size().height,
        x: monitor.position().x,
        y: monitor.position().y,
        primary: monitor.position().x == current_position.x
            && monitor.position().y == current_position.y,
    }))
}

fn state_payload(app: &AppHandle, route: &str) -> Result<DisplayWindowState, String> {
    let secondary_monitor = secondary_monitor_info(app)?;
    Ok(DisplayWindowState {
        has_secondary_monitor: secondary_monitor.is_some(),
        secondary_monitor,
        active_route: normalize_display_route(route),
        window_open: app.get_webview_window(DISPLAY_WINDOW_LABEL).is_some(),
    })
}

#[tauri::command]
async fn get_monitor_setup(app: AppHandle) -> Result<DisplayWindowState, String> {
    state_payload(&app, DISPLAY_IDLE_ROUTE)
}

#[tauri::command]
async fn ensure_customer_display_window(
    app: AppHandle,
    route: Option<String>,
) -> Result<DisplayWindowState, String> {
    let route = normalize_display_route(route.as_deref().unwrap_or(DISPLAY_IDLE_ROUTE));
    let secondary_monitor = match secondary_monitor_info(&app)? {
        Some(monitor) => monitor,
        None => return state_payload(&app, &route),
    };

    let (window, should_navigate) =
        if let Some(existing) = app.get_webview_window(DISPLAY_WINDOW_LABEL) {
            (existing, true)
        } else {
            (
                WebviewWindowBuilder::new(&app, DISPLAY_WINDOW_LABEL, display_window_url(&route))
                    .title("SERO GULD CRM — Müşteri Ekranı")
                    .decorations(false)
                    .resizable(false)
                    .skip_taskbar(true)
                    .visible(true)
                    .build()
                    .map_err(|error| error.to_string())?,
                false,
            )
        };

    show_customer_display_window(&window, &route, &secondary_monitor, should_navigate)?;

    state_payload(&app, &route)
}

#[tauri::command]
async fn close_or_idle_customer_display(app: AppHandle) -> Result<DisplayWindowState, String> {
    if let Some(window) = app.get_webview_window(DISPLAY_WINDOW_LABEL) {
        best_effort_navigate_window_to_route(&window, DISPLAY_IDLE_ROUTE);
        let _ = window.set_fullscreen(true);
        let _ = window.show();
    }
    state_payload(&app, DISPLAY_IDLE_ROUTE)
}

#[tauri::command]
async fn get_desktop_runtime_info() -> Result<DesktopRuntimeInfo, String> {
    let runtime_mode = if cfg!(debug_assertions) {
        "tauri-dev-url".to_string()
    } else {
        "embedded-app".to_string()
    };
    let binary_path = env::current_exe()
        .map_err(|error| error.to_string())?
        .display()
        .to_string();

    Ok(DesktopRuntimeInfo {
        runtime_mode,
        binary_path,
        binary_mtime_unix_ms: current_binary_mtime_unix_ms(),
        dev_base_url: if cfg!(debug_assertions) {
            Some(dev_display_base_url())
        } else {
            None
        },
    })
}

#[tauri::command]
async fn ensure_document_preview_window(
    app: AppHandle,
    route: String,
    title: Option<String>,
) -> Result<String, String> {
    let normalized = normalize_display_route(&route);
    let window = if let Some(existing) = app.get_webview_window(DOCUMENT_PREVIEW_WINDOW_LABEL) {
        existing
    } else {
        WebviewWindowBuilder::new(
            &app,
            DOCUMENT_PREVIEW_WINDOW_LABEL,
            app_window_url(&normalized),
        )
        .title(
            title
                .clone()
                .unwrap_or_else(|| "SERO GULD CRM — Office Belgesi".to_string()),
        )
        .decorations(true)
        .resizable(true)
        .visible(true)
        .inner_size(1180.0, 780.0)
        .build()
        .map_err(|error| error.to_string())?
    };

    configure_document_preview_window(&window, &normalized, title)?;
    Ok(normalized)
}

#[tauri::command]
async fn close_document_preview_window(app: AppHandle) -> Result<bool, String> {
    if let Some(window) = app.get_webview_window(DOCUMENT_PREVIEW_WINDOW_LABEL) {
        window.close().map_err(|error| error.to_string())?;
        return Ok(true);
    }
    Ok(false)
}

#[tauri::command]
async fn reopen_document_preview_window(
    app: AppHandle,
    route: String,
    title: Option<String>,
) -> Result<String, String> {
    let normalized = normalize_display_route(&route);
    if let Some(window) = app.get_webview_window(DOCUMENT_PREVIEW_WINDOW_LABEL) {
        let _ = window.close();
        sleep(Duration::from_millis(180));
    }

    let window = if let Some(existing) = app.get_webview_window(DOCUMENT_PREVIEW_WINDOW_LABEL) {
        existing
    } else {
        WebviewWindowBuilder::new(
            &app,
            DOCUMENT_PREVIEW_WINDOW_LABEL,
            app_window_url(&normalized),
        )
        .title(
            title
                .clone()
                .unwrap_or_else(|| "SERO GULD CRM — Office Belgesi".to_string()),
        )
        .decorations(true)
        .resizable(true)
        .visible(true)
        .inner_size(1180.0, 780.0)
        .build()
        .map_err(|error| error.to_string())?
    };

    configure_document_preview_window(&window, &normalized, title)?;
    Ok(normalized)
}

#[tauri::command]
async fn pick_document_import_file() -> Result<PickedDocumentFile, String> {
    let picked = rfd::FileDialog::new()
        .add_filter("Excel", &["xlsx", "xlsm"])
        .pick_file()
        .ok_or_else(|| "Dosya seçilmedi".to_string())?;

    let bytes = fs::read(&picked).map_err(|error| error.to_string())?;
    Ok(PickedDocumentFile {
        file_name: picked
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("document.xlsx")
            .to_string(),
        data_base64: BASE64.encode(bytes),
    })
}

#[cfg(target_os = "linux")]
fn pick_save_path_with_zenity(suggested_name: &str) -> Result<Option<PathBuf>, String> {
    let default_path = env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
        .join(suggested_name);

    let output = Command::new("zenity")
        .arg("--file-selection")
        .arg("--save")
        .arg(format!("--filename={}", default_path.display()))
        .arg("--file-filter=Excel files | *.xlsx *.xlsm")
        .output()
        .map_err(|error| error.to_string())?;

    if output.status.success() {
        let selected = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if selected.is_empty() {
            return Ok(None);
        }
        return Ok(Some(PathBuf::from(selected)));
    }

    Ok(None)
}

#[cfg(target_os = "linux")]
fn linux_downloads_fallback_path(suggested_name: &str) -> Result<PathBuf, String> {
    let home_dir = env::var("HOME").map_err(|error| error.to_string())?;
    let downloads_dir = PathBuf::from(home_dir).join("Downloads");
    fs::create_dir_all(&downloads_dir).map_err(|error| error.to_string())?;
    Ok(unique_path_for_save(downloads_dir.join(suggested_name)))
}

#[cfg(target_os = "linux")]
fn reveal_in_file_manager(path: &PathBuf) {
    if let Some(parent) = path.parent() {
        let _ = Command::new("xdg-open").arg(parent).spawn();
    }
}

#[tauri::command]
async fn export_document_bytes(
    suggested_name: String,
    data_base64: String,
) -> Result<DocumentExportResult, String> {
    #[cfg(target_os = "linux")]
    let (path, mode) = pick_save_path_with_zenity(&suggested_name)?
        .or_else(|| {
            rfd::FileDialog::new()
                .set_file_name(&suggested_name)
                .save_file()
        })
        .map(|selected| (selected, "save-dialog".to_string()))
        .unwrap_or((
            linux_downloads_fallback_path(&suggested_name)?,
            "downloads-fallback".to_string(),
        ));

    #[cfg(not(target_os = "linux"))]
    let (path, mode) = (
        rfd::FileDialog::new()
            .set_file_name(&suggested_name)
            .save_file()
            .ok_or_else(|| "Kayıt konumu seçilmedi".to_string())?,
        "save-dialog".to_string(),
    );

    let bytes = BASE64
        .decode(data_base64)
        .map_err(|error| error.to_string())?;
    fs::write(&path, bytes).map_err(|error| error.to_string())?;

    #[cfg(target_os = "linux")]
    if mode == "downloads-fallback" {
        reveal_in_file_manager(&path);
    }

    Ok(DocumentExportResult {
        path: path.display().to_string(),
        mode,
    })
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            if let Ok(route) = env::var("SEROGULD_DESKTOP_START_ROUTE") {
                let route = route.trim();
                if !route.is_empty() {
                    if let Some(window) = app.get_webview_window("main") {
                        best_effort_navigate_window_to_route(&window, route);
                    }
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_monitor_setup,
            ensure_customer_display_window,
            close_or_idle_customer_display,
            get_desktop_runtime_info,
            ensure_document_preview_window,
            close_document_preview_window,
            reopen_document_preview_window,
            pick_document_import_file,
            export_document_bytes
        ])
        .run(tauri::generate_context!())
        .expect("failed to start tauri application");
}
