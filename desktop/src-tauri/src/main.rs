#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};
use std::env;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::process::Command;
use std::thread::sleep;
use std::time::{Duration, UNIX_EPOCH};
use tauri::{
    AppHandle, Manager, PhysicalPosition, PhysicalSize, Url, WebviewUrl, WebviewWindowBuilder,
};

mod pending_purchase_draft;

const DISPLAY_WINDOW_LABEL: &str = "customer-display";
const DOCUMENT_PREVIEW_WINDOW_LABEL: &str = "document-preview";
const DISPLAY_IDLE_ROUTE: &str = "/display/idle";
const DEV_DISPLAY_BASE_URL: &str = "http://127.0.0.1:3300";
const IDENTITY_SCAN_MAX_BYTES: usize = 10 * 1024 * 1024;
const IDENTITY_SCAN_MIME_TYPES: [&str; 4] = ["image/jpeg", "image/png", "image/tiff", "image/bmp"];

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

/// The identity scanner only ever exposes an in-memory preview and OCR result.
/// It deliberately does not include a source path or persist a scan in the app.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct IdentityScannerCapabilities {
    supported: bool,
    platform: String,
    wia_acquisition: bool,
    local_ocr: bool,
    image_file_fallback: bool,
    max_file_bytes: usize,
    accepted_mime_types: Vec<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct IdentityScanResult {
    side: String,
    source: String,
    mime_type: String,
    preview_data_url: String,
    ocr_text: String,
    ocr_lines: Vec<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct IdentityScannerError {
    code: &'static str,
    message: &'static str,
    retryable: bool,
}

impl IdentityScannerError {
    const fn new(code: &'static str, message: &'static str, retryable: bool) -> Self {
        Self {
            code,
            message,
            retryable,
        }
    }

    #[cfg(not(target_os = "windows"))]
    const fn unsupported_platform() -> Self {
        Self::new(
            "UNSUPPORTED_PLATFORM",
            "Kimlik tarama yalnızca Windows masaüstü uygulamasında kullanılabilir.",
            false,
        )
    }

    const fn invalid_side() -> Self {
        Self::new("INVALID_REQUEST", "Kimlik yüzü geçersiz.", false)
    }

    #[cfg(target_os = "windows")]
    const fn cancelled() -> Self {
        Self::new("SCAN_CANCELLED", "Tarama iptal edildi.", true)
    }

    #[cfg(target_os = "windows")]
    const fn scanner_unavailable() -> Self {
        Self::new(
            "SCANNER_UNAVAILABLE",
            "WIA tarayıcı hizmeti veya cihazı kullanılamıyor.",
            true,
        )
    }

    #[cfg(target_os = "windows")]
    const fn acquisition_failed() -> Self {
        Self::new("ACQUISITION_FAILED", "Tarama tamamlanamadı.", true)
    }

    #[cfg(target_os = "windows")]
    const fn invalid_image() -> Self {
        Self::new(
            "INVALID_IMAGE",
            "Yalnızca geçerli JPG, PNG, TIFF veya BMP görüntüleri seçilebilir.",
            false,
        )
    }

    #[cfg(target_os = "windows")]
    const fn file_too_large() -> Self {
        Self::new(
            "FILE_TOO_LARGE",
            "Görüntü dosyası 10 MB sınırını aşıyor.",
            false,
        )
    }

    #[cfg(target_os = "windows")]
    const fn file_read_failed() -> Self {
        Self::new("FILE_READ_FAILED", "Görüntü dosyası okunamadı.", true)
    }

    #[cfg(target_os = "windows")]
    const fn ocr_unavailable() -> Self {
        Self::new(
            "OCR_UNAVAILABLE",
            "Windows yerel OCR özelliği kullanılamıyor.",
            false,
        )
    }

    #[cfg(target_os = "windows")]
    const fn ocr_failed() -> Self {
        Self::new("OCR_FAILED", "Yerel OCR işlemi tamamlanamadı.", true)
    }

    #[cfg(target_os = "windows")]
    const fn temp_cleanup_failed() -> Self {
        Self::new(
            "TEMP_CLEANUP_FAILED",
            "Geçici tarama dosyası temizlenemedi.",
            true,
        )
    }
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

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct UiDiagnosticPayload {
    occurred_at: String,
    route: String,
    ui_variant: String,
    frontend_build: String,
    error_code: String,
}

#[derive(Debug, Serialize, Clone)]
struct UiDiagnosticResult {
    path: String,
}

fn validate_ui_diagnostic(payload: UiDiagnosticPayload) -> Result<UiDiagnosticPayload, String> {
    fn safe_atom(value: &str, max_len: usize) -> bool {
        !value.is_empty()
            && value.len() <= max_len
            && value
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || "-_.:+".contains(character))
    }

    if !safe_atom(&payload.occurred_at, 48) {
        return Err("Tanılama zamanı geçersiz".to_string());
    }
    if !matches!(payload.ui_variant.as_str(), "classic" | "modern") {
        return Err("Arayüz varyantı geçersiz".to_string());
    }
    if !safe_atom(&payload.frontend_build, 96) || !safe_atom(&payload.error_code, 64) {
        return Err("Tanılama kimliği geçersiz".to_string());
    }

    let route = payload.route.split('?').next().unwrap_or("").trim();
    if !route.starts_with('/')
        || route.len() > 160
        || !route
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "/-_.:".contains(character))
    {
        return Err("Tanılama route'u geçersiz".to_string());
    }

    Ok(UiDiagnosticPayload {
        route: route.to_string(),
        ..payload
    })
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

fn display_idle_route_for_variant(ui_variant: Option<&str>) -> String {
    match ui_variant {
        Some("modern") => format!("{DISPLAY_IDLE_ROUTE}?ui=modern"),
        _ => format!("{DISPLAY_IDLE_ROUTE}?ui=classic"),
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

fn identity_scanner_platform() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "windows"
    }
    #[cfg(target_os = "macos")]
    {
        "macos"
    }
    #[cfg(target_os = "linux")]
    {
        "linux"
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        "unknown"
    }
}

fn identity_scanner_capabilities() -> IdentityScannerCapabilities {
    let supported = cfg!(target_os = "windows");
    IdentityScannerCapabilities {
        supported,
        platform: identity_scanner_platform().to_string(),
        wia_acquisition: supported,
        local_ocr: supported,
        image_file_fallback: supported,
        max_file_bytes: IDENTITY_SCAN_MAX_BYTES,
        accepted_mime_types: IDENTITY_SCAN_MIME_TYPES
            .iter()
            .map(|mime_type| (*mime_type).to_string())
            .collect(),
    }
}

fn validate_identity_scan_side(side: &str) -> Result<(), IdentityScannerError> {
    if matches!(side, "front" | "back") {
        Ok(())
    } else {
        Err(IdentityScannerError::invalid_side())
    }
}

#[cfg(any(target_os = "windows", test))]
fn identity_mime_type(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some("image/jpeg");
    }
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', b'\r', b'\n', 0x1A, b'\n']) {
        return Some("image/png");
    }
    if bytes.starts_with(&[b'I', b'I', 0x2A, 0x00]) || bytes.starts_with(&[b'M', b'M', 0x00, 0x2A])
    {
        return Some("image/tiff");
    }
    if bytes.starts_with(b"BM") {
        return Some("image/bmp");
    }
    None
}

#[cfg(any(target_os = "windows", test))]
fn expected_identity_mime_type(path: &std::path::Path) -> Option<&'static str> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    match extension.as_str() {
        "jpg" | "jpeg" => Some("image/jpeg"),
        "png" => Some("image/png"),
        "tif" | "tiff" => Some("image/tiff"),
        "bmp" => Some("image/bmp"),
        _ => None,
    }
}

#[cfg(target_os = "windows")]
fn read_identity_image(
    path: &std::path::Path,
) -> Result<(Vec<u8>, &'static str), IdentityScannerError> {
    let metadata = fs::metadata(path).map_err(|_| IdentityScannerError::file_read_failed())?;
    if !metadata.is_file() {
        return Err(IdentityScannerError::invalid_image());
    }
    if metadata.len() > IDENTITY_SCAN_MAX_BYTES as u64 {
        return Err(IdentityScannerError::file_too_large());
    }

    let bytes = fs::read(path).map_err(|_| IdentityScannerError::file_read_failed())?;
    if bytes.len() > IDENTITY_SCAN_MAX_BYTES {
        return Err(IdentityScannerError::file_too_large());
    }

    let detected_mime_type =
        identity_mime_type(&bytes).ok_or_else(IdentityScannerError::invalid_image)?;
    if expected_identity_mime_type(path) != Some(detected_mime_type) {
        return Err(IdentityScannerError::invalid_image());
    }

    Ok((bytes, detected_mime_type))
}

#[cfg(target_os = "windows")]
fn identity_scan_result(
    side: &str,
    source: &str,
    image_bytes: Vec<u8>,
    mime_type: &str,
    ocr_lines: Vec<String>,
) -> IdentityScanResult {
    IdentityScanResult {
        side: side.to_string(),
        source: source.to_string(),
        mime_type: mime_type.to_string(),
        preview_data_url: format!("data:{mime_type};base64,{}", BASE64.encode(image_bytes)),
        ocr_text: ocr_lines.join("\n"),
        ocr_lines,
    }
}

#[cfg(target_os = "windows")]
const WIA_ACQUIRE_SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
try {
  $dialog = New-Object -ComObject WIA.CommonDialog
} catch {
  exit 3
}
try {
  $device = $dialog.ShowSelectDevice()
  if ($null -eq $device) { exit 2 }
  $item = $device.Items.Item(1)
  $image = $dialog.ShowTransfer($item)
  if ($null -eq $image) { exit 2 }
  $image.SaveFile($args[0])
  exit 0
} catch {
  exit 1
}
"#;

#[cfg(target_os = "windows")]
const WINDOWS_OCR_SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
  $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
  $null = [Windows.Media.Ocr.OcrEngine, Windows.Media.Ocr, ContentType = WindowsRuntime]

  function Await-WinRt($operation) {
    $task = [System.WindowsRuntimeSystemExtensions]::AsTask($operation)
    $task.Wait()
    return $task.Result
  }

  $file = Await-WinRt ([Windows.Storage.StorageFile]::GetFileFromPathAsync($args[0]))
  $stream = Await-WinRt ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read))
  $decoder = Await-WinRt ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream))
  $bitmap = Await-WinRt ($decoder.GetSoftwareBitmapAsync())
  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
  if ($null -eq $engine) { exit 3 }
  $result = Await-WinRt ($engine.RecognizeAsync($bitmap))
  $lines = @($result.Lines | ForEach-Object { $_.Text })
  $json = $lines | ConvertTo-Json -Compress
  [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
  [Console]::WriteLine([Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($json)))
  exit 0
} catch {
  exit 1
}
"#;

#[cfg(target_os = "windows")]
struct TemporaryIdentityImage {
    directory: PathBuf,
    path: PathBuf,
}

#[cfg(target_os = "windows")]
impl TemporaryIdentityImage {
    fn new(app: &AppHandle) -> Result<Self, IdentityScannerError> {
        let scan_root = app
            .path()
            .app_cache_dir()
            .map_err(|_| IdentityScannerError::acquisition_failed())?
            .join("identity-scans");
        fs::create_dir_all(&scan_root).map_err(|_| IdentityScannerError::acquisition_failed())?;

        for _ in 0..16 {
            let directory_name =
                format!("scan-{}-{:016x}", std::process::id(), rand::random::<u64>());
            let directory = scan_root.join(directory_name);
            match fs::create_dir(&directory) {
                Ok(()) => {
                    return Ok(Self {
                        path: directory.join("identity-scan.jpg"),
                        directory,
                    });
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(_) => return Err(IdentityScannerError::acquisition_failed()),
            }
        }
        Err(IdentityScannerError::acquisition_failed())
    }

    fn remove(&self) -> Result<(), IdentityScannerError> {
        let file_result = match fs::remove_file(&self.path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(_) => Err(IdentityScannerError::temp_cleanup_failed()),
        };
        let directory_result = match fs::remove_dir(&self.directory) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(_) => Err(IdentityScannerError::temp_cleanup_failed()),
        };
        match (file_result, directory_result) {
            (Ok(()), Ok(())) => Ok(()),
            (Err(error), _) | (_, Err(error)) => Err(error),
        }
    }
}

#[cfg(target_os = "windows")]
impl Drop for TemporaryIdentityImage {
    fn drop(&mut self) {
        let _ = self.remove();
    }
}

#[cfg(target_os = "windows")]
fn run_windows_powershell(
    script: &str,
    path: &std::path::Path,
) -> Result<std::process::Output, ()> {
    Command::new("powershell.exe")
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            script,
        ])
        .arg(path)
        .output()
        .map_err(|_| ())
}

#[cfg(target_os = "windows")]
fn acquire_wia_image(path: &std::path::Path) -> Result<(), IdentityScannerError> {
    let output = run_windows_powershell(WIA_ACQUIRE_SCRIPT, path)
        .map_err(|_| IdentityScannerError::scanner_unavailable())?;
    match output.status.code() {
        Some(0) if path.is_file() => Ok(()),
        Some(2) => Err(IdentityScannerError::cancelled()),
        Some(3) => Err(IdentityScannerError::scanner_unavailable()),
        _ => Err(IdentityScannerError::acquisition_failed()),
    }
}

#[cfg(target_os = "windows")]
fn run_windows_local_ocr(path: &std::path::Path) -> Result<Vec<String>, IdentityScannerError> {
    let output = run_windows_powershell(WINDOWS_OCR_SCRIPT, path)
        .map_err(|_| IdentityScannerError::ocr_unavailable())?;
    match output.status.code() {
        Some(0) => {}
        Some(3) => return Err(IdentityScannerError::ocr_unavailable()),
        _ => return Err(IdentityScannerError::ocr_failed()),
    }

    if output.stdout.len() > 96 * 1024 {
        return Err(IdentityScannerError::ocr_failed());
    }
    let encoded_lines = std::str::from_utf8(&output.stdout)
        .map_err(|_| IdentityScannerError::ocr_failed())?
        .trim();
    let json = BASE64
        .decode(encoded_lines)
        .map_err(|_| IdentityScannerError::ocr_failed())?;
    let lines: Vec<String> =
        serde_json::from_slice(&json).map_err(|_| IdentityScannerError::ocr_failed())?;
    let mut sanitized_lines = Vec::new();
    let mut total_length = 0usize;
    for line in lines {
        let line = line.trim().to_string();
        if line.is_empty() {
            continue;
        }
        total_length += line.len();
        if total_length > 64 * 1024 {
            return Err(IdentityScannerError::ocr_failed());
        }
        sanitized_lines.push(line);
    }
    Ok(sanitized_lines)
}

#[cfg(target_os = "windows")]
fn build_windows_identity_scan_result(
    side: &str,
    source: &str,
    image_path: &std::path::Path,
) -> Result<IdentityScanResult, IdentityScannerError> {
    let (image_bytes, mime_type) = read_identity_image(image_path)?;
    let ocr_lines = run_windows_local_ocr(image_path)?;
    Ok(identity_scan_result(
        side,
        source,
        image_bytes,
        mime_type,
        ocr_lines,
    ))
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
        assert_eq!(
            display_idle_route_for_variant(Some("modern")),
            "/display/idle?ui=modern"
        );
        assert_eq!(
            display_idle_route_for_variant(Some("unexpected")),
            "/display/idle?ui=classic"
        );
    }

    #[test]
    fn validates_and_strips_ui_diagnostic_routes() {
        let payload = UiDiagnosticPayload {
            occurred_at: "2026-08-06T10:30:00.000Z".to_string(),
            route: "/depolama?customer=secret".to_string(),
            ui_variant: "modern".to_string(),
            frontend_build: "vite-dev".to_string(),
            error_code: "MODERN_RENDER_FAILED".to_string(),
        };
        let validated = validate_ui_diagnostic(payload).expect("payload should be valid");
        assert_eq!(validated.route, "/depolama");
    }

    #[test]
    fn rejects_free_form_ui_diagnostic_values() {
        let payload = UiDiagnosticPayload {
            occurred_at: "2026-08-06T10:30:00.000Z".to_string(),
            route: "/display/token".to_string(),
            ui_variant: "modern".to_string(),
            frontend_build: "vite dev with spaces".to_string(),
            error_code: "customer@example.com".to_string(),
        };
        assert!(validate_ui_diagnostic(payload).is_err());
    }

    #[test]
    fn validates_identity_scan_side_and_image_magic_bytes() {
        assert!(validate_identity_scan_side("front").is_ok());
        assert!(validate_identity_scan_side("back").is_ok());
        assert!(validate_identity_scan_side("other").is_err());

        assert_eq!(
            identity_mime_type(&[0xFF, 0xD8, 0xFF, 0xE0]),
            Some("image/jpeg")
        );
        assert_eq!(
            identity_mime_type(&[0x89, b'P', b'N', b'G', b'\r', b'\n', 0x1A, b'\n']),
            Some("image/png")
        );
        assert_eq!(
            identity_mime_type(&[b'I', b'I', 0x2A, 0x00]),
            Some("image/tiff")
        );
        assert_eq!(identity_mime_type(b"BM\0\0"), Some("image/bmp"));
        assert_eq!(identity_mime_type(b"not-an-image"), None);
    }

    #[test]
    fn requires_matching_image_extension_and_content_type() {
        assert_eq!(
            expected_identity_mime_type(std::path::Path::new("identity.jpeg")),
            Some("image/jpeg")
        );
        assert_eq!(
            expected_identity_mime_type(std::path::Path::new("identity.tiff")),
            Some("image/tiff")
        );
        assert_eq!(
            expected_identity_mime_type(std::path::Path::new("identity.pdf")),
            None
        );
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
async fn close_or_idle_customer_display(
    app: AppHandle,
    ui_variant: Option<String>,
) -> Result<DisplayWindowState, String> {
    let route = display_idle_route_for_variant(ui_variant.as_deref());
    if let Some(window) = app.get_webview_window(DISPLAY_WINDOW_LABEL) {
        best_effort_navigate_window_to_route(&window, &route);
        let _ = window.set_fullscreen(true);
        let _ = window.show();
    }
    state_payload(&app, &route)
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
async fn write_ui_diagnostic(
    app: AppHandle,
    payload: UiDiagnosticPayload,
) -> Result<UiDiagnosticResult, String> {
    let payload = validate_ui_diagnostic(payload)?;
    let log_dir = app
        .path()
        .app_log_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&log_dir).map_err(|error| error.to_string())?;
    let log_path = log_dir.join("ui-diagnostics.jsonl");
    let line = serde_json::to_string(&payload).map_err(|error| error.to_string())?;
    if line.len() > 1024 {
        return Err("Tanılama kaydı çok büyük".to_string());
    }
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|error| error.to_string())?;
    writeln!(file, "{line}").map_err(|error| error.to_string())?;

    Ok(UiDiagnosticResult {
        path: log_path.display().to_string(),
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
async fn get_identity_scanner_capabilities() -> IdentityScannerCapabilities {
    identity_scanner_capabilities()
}

#[tauri::command]
async fn acquire_identity_scan(
    app: AppHandle,
    side: String,
) -> Result<IdentityScanResult, IdentityScannerError> {
    validate_identity_scan_side(&side)?;

    #[cfg(target_os = "windows")]
    {
        let temporary_image = TemporaryIdentityImage::new(&app)?;
        let result = acquire_wia_image(&temporary_image.path)
            .and_then(|()| build_windows_identity_scan_result(&side, "wia", &temporary_image.path));
        let cleanup = temporary_image.remove();
        cleanup?;
        result
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        let _ = side;
        Err(IdentityScannerError::unsupported_platform())
    }
}

#[tauri::command]
async fn pick_identity_scan_file(side: String) -> Result<IdentityScanResult, IdentityScannerError> {
    validate_identity_scan_side(&side)?;

    #[cfg(target_os = "windows")]
    {
        let picked = rfd::FileDialog::new()
            .add_filter(
                "Kimlik görüntüsü",
                &["jpg", "jpeg", "png", "tif", "tiff", "bmp"],
            )
            .pick_file()
            .ok_or_else(IdentityScannerError::cancelled)?;
        build_windows_identity_scan_result(&side, "file", &picked)
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = side;
        Err(IdentityScannerError::unsupported_platform())
    }
}

/// Scans are returned directly to the frontend and are never persisted by the desktop shell.
/// This command lets callers use one explicit lifecycle method without retaining file paths.
#[tauri::command]
async fn discard_identity_scan() -> Result<bool, IdentityScannerError> {
    #[cfg(target_os = "windows")]
    {
        Ok(true)
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err(IdentityScannerError::unsupported_platform())
    }
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
            write_ui_diagnostic,
            ensure_document_preview_window,
            close_document_preview_window,
            reopen_document_preview_window,
            get_identity_scanner_capabilities,
            acquire_identity_scan,
            pick_identity_scan_file,
            discard_identity_scan,
            pick_document_import_file,
            export_document_bytes,
            pending_purchase_draft::persist_pending_purchase_draft,
            pending_purchase_draft::list_pending_purchase_drafts,
            pending_purchase_draft::delete_pending_purchase_draft
        ])
        .run(tauri::generate_context!())
        .expect("failed to start tauri application");
}
