#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};

mod backup;
mod pending_purchase_draft;
use serde::{Deserialize, Serialize};
#[cfg(target_os = "windows")]
use std::collections::HashMap;
use std::env;
use std::fs::{self, File, OpenOptions};
#[cfg(target_os = "windows")]
use std::io::Read;
use std::io::Write;
#[cfg(target_os = "windows")]
use std::net::{TcpListener, TcpStream};
#[cfg(target_os = "windows")]
use std::os::windows::io::AsRawHandle;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread::sleep;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State, Url, WebviewUrl,
    WebviewWindowBuilder, WindowEvent,
};

#[cfg(target_os = "windows")]
use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
#[cfg(target_os = "windows")]
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};
const DISPLAY_WINDOW_LABEL: &str = "customer-display";
const DOCUMENT_PREVIEW_WINDOW_LABEL: &str = "document-preview";
const DISPLAY_IDLE_ROUTE: &str = "/display/idle";
const DISPLAY_SETTINGS_FILE: &str = "customer-display-settings.v1.json";
const DEV_DISPLAY_BASE_URL: &str = "http://127.0.0.1:3300";
const IDENTITY_SCAN_MAX_BYTES: usize = 10 * 1024 * 1024;
const IDENTITY_SCAN_MIME_TYPES: [&str; 4] = ["image/jpeg", "image/png", "image/tiff", "image/bmp"];
const LOCAL_BACKEND_HEALTH_URL: &str = "http://127.0.0.1:8100/health";
const RUNTIME_RELATIVE_PATH: &str = "runtime/seroguld-runtime/seroguld-runtime.exe";
const EXCEL_FOCUS_COMMAND: &[u8] = b"{\"action\":\"focus\"}\n";
#[cfg(any(target_os = "windows", test))]
const STARTUP_TIMEOUT_SECONDS: u64 = 30;
// Keep the native save window bounded.  The frontend already flushes embedded
// edits before calling into this path; a hung COM bridge must hand control back
// to the Retry / Discard / Return dialog within the product's ten-second
// shutdown budget.
const EXCEL_CLOSE_TIMEOUT_SECONDS: u64 = 10;
#[cfg(target_os = "windows")]
const KEYRING_SERVICE: &str = "dk.seroguld.crm";

#[derive(Debug, Serialize, Clone)]
struct RuntimeStatus {
    app_version: String,
    state: String,
    message: String,
    runtime_path: Option<String>,
    health_url: String,
    logs_dir: Option<String>,
    backend_pid: Option<u32>,
    excel_bridge_running: bool,
    excel_close_failed: bool,
    excel_close_error: Option<String>,
}

#[derive(Debug, Clone)]
struct DesktopPaths {
    root: PathBuf,
    logs: PathBuf,
}

impl DesktopPaths {
    fn prepare() -> Result<Self, String> {
        // The installed application has one canonical data root.  An
        // inherited SEROGULD_PROGRAM_DATA must not be able to redirect a
        // release build to an arbitrary database/configuration directory.
        // The override remains useful for `tauri dev` and local tests only.
        let root = if cfg!(debug_assertions) {
            env::var("SEROGULD_PROGRAM_DATA")
                .ok()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .map(PathBuf::from)
                .unwrap_or_else(Self::default_root)
        } else {
            Self::default_root()
        };
        let logs = root.join("logs");
        let config = root.join("config");
        fs::create_dir_all(&logs)
            .map_err(|error| format!("Çalışma alanı hazırlanamadı: {error}"))?;
        fs::create_dir_all(&config)
            .map_err(|error| format!("Runtime yapılandırma alanı hazırlanamadı: {error}"))?;
        fs::create_dir_all(root.join("documents").join("working"))
            .map_err(|error| format!("Belge çalışma alanı hazırlanamadı: {error}"))?;
        let paths = Self { root, logs };
        if let Err(error) = paths.secure_private_storage() {
            // `paths()` cannot publish an unprotected root into supervisor
            // state, but keep a generic diagnostic when the directory itself
            // is still writable.  Never include SIDs, command output, or
            // secret values in this fallback line.
            if let Ok(mut log) = OpenOptions::new()
                .create(true)
                .append(true)
                .open(paths.desktop_log())
            {
                let timestamp = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|value| value.as_secs())
                    .unwrap_or_default();
                let _ = writeln!(
                    log,
                    "{timestamp} [security] Runtime yapılandırması güvenli hale getirilemedi"
                );
            }
            return Err(error);
        }
        Ok(paths)
    }

    #[cfg(target_os = "windows")]
    fn default_root() -> PathBuf {
        env::var_os("PROGRAMDATA")
            .map(PathBuf::from)
            // Windows normally always defines PROGRAMDATA.  If a hostile or
            // broken environment removes it, keep the release contract
            // canonical rather than silently falling back to a broad TEMP
            // directory for customer data and secrets.
            .unwrap_or_else(|| PathBuf::from(r"C:\ProgramData"))
            .join("SeroGuldCRM")
    }

    #[cfg(not(target_os = "windows"))]
    fn default_root() -> PathBuf {
        env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(".run")
            .join("SeroGuldCRM")
    }

    fn desktop_log(&self) -> PathBuf {
        self.logs.join("desktop.log")
    }

    #[cfg(target_os = "windows")]
    fn runtime_env(&self) -> PathBuf {
        self.root.join("config").join("runtime.env")
    }

    /// Protect the local runtime configuration before the packaged backend is
    /// started.  The runtime env contains API credentials and encryption keys;
    /// it must not inherit the broad ProgramData/Users ACL.  On non-Windows
    /// development hosts this is intentionally a no-op.
    fn secure_private_storage(&self) -> Result<(), String> {
        #[cfg(target_os = "windows")]
        {
            let sid = current_interactive_user_sid()?;
            secure_windows_path(&self.root, true, &sid)?;
            secure_windows_path(&self.root.join("config"), true, &sid)?;
            if self.runtime_env().is_file() {
                secure_windows_path(&self.runtime_env(), false, &sid)?;
            }
        }
        Ok(())
    }

    /// The backend creates/updates runtime.env during `migrate`.  Re-apply the
    /// file ACL after that process exits so a newly-created file cannot retain
    /// an inherited broad read grant.  Failure is returned before `serve` is
    /// spawned, keeping startup fail-closed for secrets.
    #[cfg(target_os = "windows")]
    fn secure_runtime_env(&self) -> Result<(), String> {
        #[cfg(target_os = "windows")]
        {
            let env_file = self.runtime_env();
            if !env_file.is_file() {
                return Err("Runtime yapılandırma dosyası oluşturulamadı".to_string());
            }
            let sid = current_interactive_user_sid()?;
            secure_windows_path(&env_file, false, &sid)?;
        }
        Ok(())
    }
}

#[cfg(any(target_os = "windows", test))]
fn parse_windows_sid(raw: &str) -> Option<String> {
    raw.split(|character: char| character == ',' || character == '"' || character.is_whitespace())
        .map(str::trim)
        .find(|candidate| {
            let mut parts = candidate.split('-');
            matches!(parts.next(), Some("S"))
                && parts.next().is_some_and(|value| !value.is_empty())
                && parts.all(|value| !value.is_empty() && value.chars().all(|c| c.is_ascii_digit()))
        })
        .map(ToOwned::to_owned)
}

#[cfg(target_os = "windows")]
fn current_interactive_user_sid() -> Result<String, String> {
    let mut command = Command::new("whoami.exe");
    command
        .args(["/user", "/fo", "csv", "/nh"])
        .creation_flags(0x08000000);
    let output = command
        .output()
        .map_err(|_| "Windows kullanıcı güvenliği doğrulanamadı".to_string())?;
    if !output.status.success() {
        return Err("Windows kullanıcı güvenliği doğrulanamadı".to_string());
    }
    let output = String::from_utf8_lossy(&output.stdout);
    parse_windows_sid(&output)
        .ok_or_else(|| "Windows kullanıcı güvenliği doğrulanamadı".to_string())
}

#[cfg(target_os = "windows")]
fn secure_windows_path(
    path: &std::path::Path,
    directory: bool,
    user_sid: &str,
) -> Result<(), String> {
    let path = path
        .to_str()
        .ok_or_else(|| "Runtime güvenlik yolu geçersiz".to_string())?;
    let system_grant = if directory {
        "*S-1-5-18:(OI)(CI)(F)".to_string()
    } else {
        "*S-1-5-18:F".to_string()
    };
    let administrators_grant = if directory {
        "*S-1-5-32-544:(OI)(CI)(F)".to_string()
    } else {
        "*S-1-5-32-544:F".to_string()
    };
    let user_grant = if directory {
        format!("*{user_sid}:(OI)(CI)(F)")
    } else {
        format!("*{user_sid}:F")
    };
    let mut command = Command::new("icacls.exe");
    command
        .arg(path)
        // Remove inherited grants first, then grant only SYSTEM, local
        // Administrators and the interactive user.  The explicit removals
        // cover common broad principals even if an older installation had
        // written explicit (rather than inherited) ACEs.
        .args([
            "/inheritance:r",
            "/remove:g",
            "*S-1-1-0",
            "*S-1-5-11",
            "*S-1-5-32-545",
        ])
        .arg("/grant:r")
        .arg(system_grant)
        .arg("/grant:r")
        .arg(administrators_grant)
        .arg("/grant:r")
        .arg(user_grant)
        .creation_flags(0x08000000);
    let output = command
        .output()
        .map_err(|_| "Runtime yapılandırması güvenli hale getirilemedi".to_string())?;
    if !output.status.success() {
        return Err("Runtime yapılandırması güvenli hale getirilemedi".to_string());
    }
    Ok(())
}

#[cfg(target_os = "windows")]
struct WindowsJobObject {
    handle: HANDLE,
}

#[cfg(not(target_os = "windows"))]
struct WindowsJobObject;

#[cfg(target_os = "windows")]
unsafe impl Send for WindowsJobObject {}
#[cfg(target_os = "windows")]
unsafe impl Sync for WindowsJobObject {}

#[cfg(target_os = "windows")]
impl WindowsJobObject {
    fn new() -> Result<Self, String> {
        let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if handle.is_null() {
            return Err(format!(
                "Windows Job Object oluşturulamadı: {}",
                std::io::Error::last_os_error()
            ));
        }

        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let configured = unsafe {
            SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                &mut limits as *mut _ as *mut std::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        };
        if configured == 0 {
            unsafe { CloseHandle(handle) };
            return Err(format!(
                "Windows Job Object yapılandırılamadı: {}",
                std::io::Error::last_os_error()
            ));
        }
        Ok(Self { handle })
    }

    fn assign(&self, child: &Child) -> Result<(), String> {
        let assigned =
            unsafe { AssignProcessToJobObject(self.handle, child.as_raw_handle() as HANDLE) };
        if assigned == 0 {
            return Err(format!(
                "Runtime Job Object'a alınamadı: {}",
                std::io::Error::last_os_error()
            ));
        }
        Ok(())
    }
}

#[cfg(target_os = "windows")]
impl Drop for WindowsJobObject {
    fn drop(&mut self) {
        if !self.handle.is_null() {
            unsafe { CloseHandle(self.handle) };
        }
    }
}

#[cfg(not(target_os = "windows"))]
impl WindowsJobObject {
    fn new() -> Result<Self, String> {
        Ok(Self)
    }

    fn assign(&self, _child: &Child) -> Result<(), String> {
        Ok(())
    }
}

struct ExcelLaunchReservation<'a> {
    flag: &'a AtomicBool,
}

impl Drop for ExcelLaunchReservation<'_> {
    fn drop(&mut self) {
        self.flag.store(false, Ordering::Release);
    }
}

#[allow(dead_code)]
#[derive(Clone)]
struct ExcelSessionContext {
    close_url: String,
    session_token: String,
}

struct RuntimeSupervisor {
    backend: Mutex<Option<Child>>,
    excel_bridge: Mutex<Option<Child>>,
    excel_stdin: Mutex<Option<ChildStdin>>,
    excel_session: Mutex<Option<ExcelSessionContext>>,
    job: Mutex<Option<WindowsJobObject>>,
    paths: Mutex<Option<DesktopPaths>>,
    status: Mutex<RuntimeStatus>,
    excel_operation: Mutex<()>,
    excel_probe_cache: Mutex<Option<ExcelComProbeResult>>,
    start_in_progress: AtomicBool,
    excel_launch_in_progress: AtomicBool,
    close_request_pending: AtomicBool,
    close_confirmed: AtomicBool,
}

impl RuntimeSupervisor {
    fn new() -> Self {
        Self {
            backend: Mutex::new(None),
            excel_bridge: Mutex::new(None),
            excel_stdin: Mutex::new(None),
            excel_session: Mutex::new(None),
            job: Mutex::new(None),
            paths: Mutex::new(None),
            status: Mutex::new(RuntimeStatus {
                app_version: env!("CARGO_PKG_VERSION").to_string(),
                state: "not-started".to_string(),
                message: "Yerel runtime henüz başlatılmadı".to_string(),
                runtime_path: None,
                health_url: LOCAL_BACKEND_HEALTH_URL.to_string(),
                logs_dir: None,
                backend_pid: None,
                excel_bridge_running: false,
                excel_close_failed: false,
                excel_close_error: None,
            }),
            excel_operation: Mutex::new(()),
            excel_probe_cache: Mutex::new(None),
            start_in_progress: AtomicBool::new(false),
            excel_launch_in_progress: AtomicBool::new(false),
            close_request_pending: AtomicBool::new(false),
            close_confirmed: AtomicBool::new(false),
        }
    }

    fn set_status(&self, state: &str, message: impl Into<String>) {
        let message = message.into();
        if let Ok(mut status) = self.status.lock() {
            status.state = state.to_string();
            status.message = message.clone();
        }
        self.append_diagnostic(state, &message);
    }

    fn append_diagnostic(&self, state: &str, message: &str) {
        // Keep diagnostic details in ProgramData without ever serializing
        // command payloads, bearer tokens, or workbook contents.
        let log_path = self
            .paths
            .lock()
            .ok()
            .and_then(|paths| paths.as_ref().map(DesktopPaths::desktop_log));
        if let Some(log_path) = log_path {
            if let Ok(mut log) = OpenOptions::new().create(true).append(true).open(log_path) {
                let timestamp = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|value| value.as_secs())
                    .unwrap_or_default();
                let _ = writeln!(log, "{timestamp} [{state}] {message}");
            }
        }
    }

    fn paths(&self) -> Result<DesktopPaths, String> {
        let mut guard = self
            .paths
            .lock()
            .map_err(|_| "Runtime durumu kilitlendi".to_string())?;
        if let Some(paths) = guard.clone() {
            return Ok(paths);
        }
        let paths = DesktopPaths::prepare()?;
        *guard = Some(paths.clone());
        if let Ok(mut status) = self.status.lock() {
            status.logs_dir = Some(paths.logs.display().to_string());
        }
        Ok(paths)
    }

    fn set_runtime_path(&self, path: Option<PathBuf>) {
        if let Ok(mut status) = self.status.lock() {
            status.runtime_path = path.map(|value| value.display().to_string());
        }
    }

    fn runtime_path(&self, app: &AppHandle) -> Option<PathBuf> {
        // The override is useful for `tauri dev`, but accepting an arbitrary
        // executable path in an installed release would let an inherited
        // environment variable turn application startup into an unintended
        // code-execution primitive.  Release builds must use the bundled
        // sidecar only.
        if cfg!(debug_assertions) {
            if let Ok(value) = env::var("SEROGULD_RUNTIME_EXE") {
                let path = PathBuf::from(value.trim());
                if path.is_file() {
                    return Some(path);
                }
            }
        }
        let resource_path = app
            .path()
            .resource_dir()
            .ok()
            .map(|root| root.join(RUNTIME_RELATIVE_PATH));
        let current_path = env::current_exe()
            .ok()
            .and_then(|path| path.parent().map(|root| root.join(RUNTIME_RELATIVE_PATH)));
        resource_path
            .into_iter()
            .chain(current_path)
            .find(|path| path.is_file())
    }

    fn ensure_job(&self) -> Result<(), String> {
        let mut guard = self
            .job
            .lock()
            .map_err(|_| "Runtime Job Object kilitlendi".to_string())?;
        if guard.is_none() {
            *guard = Some(WindowsJobObject::new()?);
        }
        Ok(())
    }

    fn open_log_streams(paths: &DesktopPaths) -> Result<(File, File), String> {
        let output = OpenOptions::new()
            .create(true)
            .append(true)
            .open(paths.desktop_log())
            .map_err(|error| format!("Desktop log açılamadı: {error}"))?;
        let error_output = output
            .try_clone()
            .map_err(|error| format!("Desktop log kopyalanamadı: {error}"))?;
        Ok((output, error_output))
    }

    fn spawn_mode(
        &self,
        app: &AppHandle,
        mode: &str,
        stdin_payload: Option<String>,
    ) -> Result<SpawnedRuntime, String> {
        let runtime = self
            .runtime_path(app)
            .ok_or_else(|| format!("Paketlenmiş runtime bulunamadı: {RUNTIME_RELATIVE_PATH}"))?;
        let paths = self.paths()?;
        self.ensure_job()?;
        let (stdout, stderr) = Self::open_log_streams(&paths)?;
        let mut command = Command::new(&runtime);
        command
            .arg(mode)
            .current_dir(&paths.root)
            .env("SEROGULD_PROGRAM_DATA", &paths.root)
            .env("PYTHONUNBUFFERED", "1")
            .stdout(Stdio::from(stdout))
            .stderr(Stdio::from(stderr));
        if stdin_payload.is_some() {
            command.stdin(Stdio::piped());
        } else {
            command.stdin(Stdio::null());
        }
        #[cfg(target_os = "windows")]
        command.creation_flags(0x08000000);
        let mut child = command
            .spawn()
            .map_err(|error| format!("{mode} runtime başlatılamadı: {error}"))?;

        // Put every owned runtime process in the kill-on-close Job Object
        // before sending any bridge configuration.  If stdin fails, the
        // child is explicitly terminated; dropping Child alone does not kill
        // a Windows process and would leave a hidden orphan behind.
        if let Some(job) = self
            .job
            .lock()
            .map_err(|_| "Runtime Job Object kilitlendi".to_string())?
            .as_ref()
        {
            if let Err(error) = job.assign(&child) {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error);
            }
        }
        if let Some(payload) = stdin_payload {
            if let Some(stdin) = child.stdin.as_mut() {
                if let Err(error) = stdin
                    .write_all(format!("{payload}\n").as_bytes())
                    .and_then(|_| stdin.flush())
                {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!(
                        "Excel bridge yapılandırması gönderilemedi: {error}"
                    ));
                }
            }
        }
        self.set_runtime_path(Some(runtime));
        let stdin = child.stdin.take();
        Ok(SpawnedRuntime { child, stdin })
    }

    #[cfg(target_os = "windows")]
    fn foreign_port_detected() -> bool {
        // Bind the exact loopback address used by the packaged backend. This
        // catches a stale/foreign listener even when it does not implement
        // `/health`; the desktop must never attach to or silently compete
        // with that process.
        TcpListener::bind("127.0.0.1:8100").is_err()
    }

    #[cfg(target_os = "windows")]
    fn health_check_until(deadline: Option<Instant>) -> bool {
        let timeout = |deadline: Option<Instant>| -> Option<Duration> {
            deadline
                .map(|value| value.checked_duration_since(Instant::now()))
                .unwrap_or(Some(Duration::from_secs(2)))
                .map(|value| value.min(Duration::from_secs(2)))
        };
        let Some(connect_timeout) = timeout(deadline) else {
            return false;
        };
        let address = "127.0.0.1:8100";
        let Ok(mut stream) = TcpStream::connect_timeout(
            &address.parse().expect("local backend address"),
            connect_timeout,
        ) else {
            return false;
        };
        let Some(write_timeout) = timeout(deadline) else {
            return false;
        };
        let _ = stream.set_read_timeout(Some(write_timeout));
        let _ = stream.set_write_timeout(Some(write_timeout));
        if stream
            .write_all(b"GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
            .is_err()
        {
            return false;
        }
        let Some(read_timeout) = timeout(deadline) else {
            return false;
        };
        let _ = stream.set_read_timeout(Some(read_timeout));
        let mut response = String::new();
        let _ = stream.read_to_string(&mut response);
        response.starts_with("HTTP/1.1 2") || response.starts_with("HTTP/1.0 2")
    }

    fn start(&self, app: &AppHandle) {
        if self.start_in_progress.swap(true, Ordering::AcqRel) {
            return;
        }
        self.start_inner(app);
        self.start_in_progress.store(false, Ordering::Release);
    }

    fn start_inner(&self, app: &AppHandle) {
        let _ = app;
        // Include path/ACL preparation in the same customer-facing startup
        // window as migration and health readiness.  A slow or blocked
        // security operation must not make the nominal "30 seconds" begin
        // only after the expensive preparation has already completed.
        #[cfg(target_os = "windows")]
        let startup_deadline = Instant::now() + Duration::from_secs(STARTUP_TIMEOUT_SECONDS);
        if let Err(error) = self.paths() {
            self.set_status("failed", error);
            return;
        }
        if cfg!(debug_assertions) {
            self.set_status(
                "dev",
                "Geliştirme modunda yerel runtime Tauri tarafından başlatılmıyor",
            );
            return;
        }
        #[cfg(not(target_os = "windows"))]
        {
            self.set_status(
                "unsupported",
                "Paketlenmiş Windows runtime yalnızca Windows üzerinde çalışır",
            );
            return;
        }
        #[cfg(target_os = "windows")]
        {
            self.set_status(
                "starting",
                "Veritabanı migration ve yerel servis başlatılıyor",
            );
            let result = (|| -> Result<(), String> {
                // Migration and health readiness share one deadline.  A hung
                // migration must not consume 30 seconds and then receive a
                // second 30-second serve timeout before the failure screen.
                if Instant::now() >= startup_deadline {
                    return Err("Yerel backend 30 saniye içinde hazır olmadı".to_string());
                }
                // Any listener on the fixed local port before our child starts
                // belongs to another process. Probe the port itself as well
                // as `/health`, because a foreign service may not implement
                // our health endpoint. Never attach the UI to or compete
                // with that process by mistake.
                if Self::foreign_port_detected() || Self::health_check_until(Some(startup_deadline))
                {
                    return Err(
                        "127.0.0.1:8100 başka bir servis tarafından kullanılıyor".to_string()
                    );
                }
                let mut migrate = self.spawn_mode(app, "migrate", None)?.child;
                let status = loop {
                    match migrate.try_wait() {
                        Ok(Some(status)) => break status,
                        Ok(None) if Instant::now() < startup_deadline => {
                            sleep(Duration::from_millis(100));
                        }
                        Ok(None) => {
                            let _ = migrate.kill();
                            let _ = migrate.wait();
                            return Err(
                                "Veritabanı migration 30 saniye içinde tamamlanmadı".to_string()
                            );
                        }
                        Err(error) => {
                            let _ = migrate.kill();
                            let _ = migrate.wait();
                            return Err(format!("Migration durumu okunamadı: {error}"));
                        }
                    }
                };
                if !status.success() {
                    return Err(format!("Veritabanı migration başarısız oldu: {status}"));
                }
                if Instant::now() >= startup_deadline {
                    return Err("Yerel backend 30 saniye içinde hazır olmadı".to_string());
                }
                // `migrate` creates/rewrites config/runtime.env.  Verify its
                // ACL before allowing the long-lived backend to start; a
                // permissions failure must never leave API credentials
                // readable through the inherited ProgramData ACL.
                self.paths()?
                    .secure_runtime_env()
                    .map_err(|_| "Runtime yapılandırması güvenli hale getirilemedi".to_string())?;
                let mut serve = self.spawn_mode(app, "serve", None)?.child;
                let pid = serve.id();
                {
                    let backend_lock = self
                        .backend
                        .lock()
                        .map_err(|_| "Backend runtime kilitlendi".to_string());
                    let Ok(mut backend) = backend_lock else {
                        let _ = serve.kill();
                        let _ = serve.wait();
                        return Err("Backend runtime kilitlendi".to_string());
                    };
                    *backend = Some(serve);
                }
                if let Ok(mut status) = self.status.lock() {
                    status.backend_pid = Some(pid);
                }
                while Instant::now() < startup_deadline {
                    if let Ok(mut backend) = self.backend.lock() {
                        if let Some(child) = backend.as_mut() {
                            if let Some(exit_status) = child
                                .try_wait()
                                .map_err(|error| format!("Backend durumu okunamadı: {error}"))?
                            {
                                return Err(format!("Backend erken kapandı: {exit_status}"));
                            }
                        }
                    }
                    if Self::health_check_until(Some(startup_deadline)) {
                        self.set_status("ready", "Yerel backend hazır");
                        return Ok(());
                    }
                    sleep(Duration::from_millis(250));
                }
                Err("Yerel backend 30 saniye içinde hazır olmadı".to_string())
            })();
            if let Err(error) = result {
                self.stop_backend();
                self.set_status("failed", error);
            }
        }
    }

    fn stop_backend(&self) {
        if let Ok(mut guard) = self.backend.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
        if let Ok(mut status) = self.status.lock() {
            status.backend_pid = None;
        }
    }

    fn snapshot(&self) -> RuntimeStatus {
        let mut status = self
            .status
            .lock()
            .map(|value| value.clone())
            .unwrap_or_else(|_| RuntimeStatus {
                app_version: env!("CARGO_PKG_VERSION").to_string(),
                state: "failed".to_string(),
                message: "Runtime durumu okunamadı".to_string(),
                runtime_path: None,
                health_url: LOCAL_BACKEND_HEALTH_URL.to_string(),
                logs_dir: None,
                backend_pid: None,
                excel_bridge_running: false,
                excel_close_failed: false,
                excel_close_error: None,
            });
        let mut backend_exited = false;
        if let Ok(mut backend) = self.backend.lock() {
            if let Some(child) = backend.as_mut() {
                if child.try_wait().ok().flatten().is_some() {
                    *backend = None;
                    backend_exited = true;
                }
            }
            status.backend_pid = backend.as_ref().map(Child::id);
        }
        if backend_exited {
            status.state = "failed".to_string();
            status.message = "Yerel backend beklenmedik şekilde kapandı".to_string();
            self.set_status("failed", "Yerel backend beklenmedik şekilde kapandı");
        }
        if let Ok(mut bridge) = self.excel_bridge.lock() {
            if let Some(child) = bridge.as_mut() {
                if let Ok(Some(exit_status)) = child.try_wait() {
                    *bridge = None;
                    if let Ok(mut stdin) = self.excel_stdin.lock() {
                        *stdin = None;
                    }
                    if exit_status.success() {
                        // The bridge only returns zero after its final sync
                        // and backend close notification succeeded, including
                        // when the user closes Excel directly.
                        self.clear_excel_close_failure();
                        self.clear_excel_session_context();
                    } else {
                        self.mark_excel_close_failed(format!(
                            "Excel bridge beklenmedik şekilde kapandı: {exit_status}"
                        ));
                    }
                }
            }
            status.excel_bridge_running = bridge.is_some();
        }
        // A bridge exit may have just changed the persisted close/error state
        // while the snapshot's first clone was already in hand.  Copy the
        // authoritative values before returning so the UI cannot briefly
        // report a failed close as clean (or vice versa).
        if let Ok(native_status) = self.status.lock() {
            status.excel_close_failed = native_status.excel_close_failed;
            status.excel_close_error = native_status.excel_close_error.clone();
        }
        status
    }

    fn launch_excel_bridge(
        &self,
        app: &AppHandle,
        mut request: ExcelBridgeRequest,
    ) -> Result<ExcelBridgeStatus, String> {
        let _operation = self
            .excel_operation
            .lock()
            .map_err(|_| "Excel işlemi kilitlendi".to_string())?;
        if self.excel_launch_in_progress.swap(true, Ordering::AcqRel) {
            return Err("Excel bridge başlatma işlemi zaten devam ediyor".to_string());
        }
        let _launch_reservation = ExcelLaunchReservation {
            flag: &self.excel_launch_in_progress,
        };
        if !excel_available().available {
            return Err("Microsoft Excel bu bilgisayarda bulunamadı".to_string());
        }
        let current = self.snapshot();
        if current.excel_bridge_running {
            return Err("Başka bir Excel belgesi düzenleniyor".to_string());
        }
        if current.excel_close_failed {
            return Err(
                "Önce başarısız Excel kapanışını tekrar deneyin veya değişiklikleri iptal edin"
                    .to_string(),
            );
        }
        if request.session_token.trim().is_empty() {
            return Err("Excel oturum tokenı boş olamaz".to_string());
        }
        if request.session_token.contains(['\r', '\n']) {
            return Err("Excel oturum tokenı geçersiz".to_string());
        }
        let paths = self.paths()?;
        let requested = PathBuf::from(request.workbook_path.trim());
        let session_id = requested
            .components()
            .next()
            .and_then(|component| match component {
                std::path::Component::Normal(value) => value.to_str(),
                _ => None,
            })
            .ok_or_else(|| "Excel session kimliği bulunamadı".to_string())?;
        validate_excel_bridge_urls(&request, session_id)?;
        let requested_path = resolve_managed_excel_path(&paths, request.workbook_path.trim())?;
        request.workbook_path = requested_path.display().to_string();
        let close_url = request
            .close_url
            .clone()
            .ok_or_else(|| "Excel kapanış adresi gerekli".to_string())?;
        let payload = serde_json::to_string(&request).map_err(|error| error.to_string())?;
        let mut launched = self.spawn_mode(app, "excel-bridge", Some(payload))?;
        let pid = launched.child.id();
        // COM startup is asynchronous, but a DispatchEx/Open failure is
        // normally reported within the first second.  Do not tell the UI
        // that an Excel session is managed when the bridge already died.
        let probe_deadline = Instant::now() + Duration::from_millis(1200);
        loop {
            match launched.child.try_wait() {
                Ok(Some(status)) => {
                    return Err(format!("Excel bridge başlatılamadı: {status}"));
                }
                Ok(None) if Instant::now() < probe_deadline => {
                    sleep(Duration::from_millis(50));
                }
                Ok(None) => break,
                Err(error) => {
                    let _ = launched.child.kill();
                    let _ = launched.child.wait();
                    return Err(format!("Excel bridge durumu okunamadı: {error}"));
                }
            }
        }
        // Keep lock order bridge -> stdin -> session consistent with
        // `snapshot()`.  This avoids a launch/snapshot deadlock while the
        // short-lived probe is promoting a child to supervisor ownership.
        let mut bridge_guard = match self.excel_bridge.lock() {
            Ok(guard) => guard,
            Err(_) => {
                let _ = launched.child.kill();
                let _ = launched.child.wait();
                return Err("Excel bridge kilitlendi".to_string());
            }
        };
        let mut stdin_guard = match self.excel_stdin.lock() {
            Ok(guard) => guard,
            Err(_) => {
                let _ = launched.child.kill();
                let _ = launched.child.wait();
                return Err("Excel bridge stdin kilitlendi".to_string());
            }
        };
        let mut session_guard = match self.excel_session.lock() {
            Ok(guard) => guard,
            Err(_) => {
                let _ = launched.child.kill();
                let _ = launched.child.wait();
                return Err("Excel oturumu kilitlendi".to_string());
            }
        };
        *stdin_guard = launched.stdin.take();
        *bridge_guard = Some(launched.child);
        *session_guard = Some(ExcelSessionContext {
            close_url,
            session_token: request.session_token,
        });
        if let Ok(mut status) = self.status.lock() {
            status.excel_close_failed = false;
            status.excel_close_error = None;
        }
        Ok(ExcelBridgeStatus {
            running: true,
            pid: Some(pid),
            message: "Excel bridge başlatıldı".to_string(),
        })
    }

    fn close_excel_bridge(&self) -> Result<bool, String> {
        let _operation = self
            .excel_operation
            .lock()
            .map_err(|_| "Excel işlemi kilitlendi".to_string())?;
        let mut child = match self
            .excel_bridge
            .lock()
            .map_err(|_| "Excel bridge kilitlendi".to_string())?
            .take()
        {
            Some(child) => child,
            None => {
                let failed = self
                    .status
                    .lock()
                    .map(|status| status.excel_close_failed)
                    .unwrap_or(true);
                if failed {
                    return Err("Excel bridge son kaydı başarısız oldu; tekrar deneyin".to_string());
                }
                return Ok(true);
            }
        };
        if let Err(error) = self.send_excel_command(b"{\"action\":\"close\"}\n") {
            let error = format!("Excel bridge kapanış komutu gönderilemedi: {error}");
            // A broken pipe does not prove that Excel saved successfully.  Keep
            // the process owned by the supervisor so the user can return to the
            // app, repair Excel/the connection, and retry.  Dropping `Child`
            // would orphan the hidden bridge on Windows.
            self.restore_excel_bridge(child);
            self.mark_excel_close_failed(error.clone());
            return Err(error);
        }
        let deadline = Instant::now() + Duration::from_secs(EXCEL_CLOSE_TIMEOUT_SECONDS);
        loop {
            match child.try_wait() {
                Ok(Some(status)) => {
                    if let Ok(mut stdin) = self.excel_stdin.lock() {
                        *stdin = None;
                    }
                    if !status.success() {
                        self.mark_excel_close_failed(format!("Excel bridge çıkış kodu: {status}"));
                    } else {
                        self.clear_excel_close_failure();
                        self.clear_excel_session_context();
                    }
                    return Ok(status.success());
                }
                Ok(None) if Instant::now() < deadline => sleep(Duration::from_millis(100)),
                Ok(None) => {
                    let error = "Excel bridge 10 saniye içinde kapanmadı".to_string();
                    // Do not kill a bridge which may still be flushing/syncing
                    // the workbook.  Keeping both process ownership and stdin
                    // lets the close request be retried after the user returns
                    // to the application; explicit discard is the only path
                    // allowed to force termination after its own timeout.
                    self.restore_excel_bridge(child);
                    self.mark_excel_close_failed(error.clone());
                    return Err(error);
                }
                Err(error) => {
                    let error = format!("Excel bridge durumu okunamadı: {error}");
                    self.restore_excel_bridge(child);
                    self.mark_excel_close_failed(error.clone());
                    return Err(error);
                }
            }
        }
    }

    fn focus_excel_bridge(&self) -> Result<bool, String> {
        let _operation = self
            .excel_operation
            .lock()
            .map_err(|_| "Excel işlemi kilitlendi".to_string())?;
        if !self.snapshot().excel_bridge_running {
            return Err("Yönetilen Excel oturumu açık değil".to_string());
        }
        self.send_excel_command(EXCEL_FOCUS_COMMAND)
            .map_err(|error| {
                let message = format!("Yönetilen Excel penceresi öne getirilemedi: {error}");
                self.mark_excel_close_failed(message.clone());
                message
            })?;
        Ok(true)
    }

    fn shutdown(&self) {
        let _ = self.close_excel_bridge();
        self.stop_backend();
        let bridge_running = self
            .excel_bridge
            .lock()
            .map(|bridge| bridge.is_some())
            .unwrap_or(true);
        if let Ok(mut status) = self.status.lock() {
            status.backend_pid = None;
            // A normal close failure restores the bridge so the user can
            // return to the app and retry.  Never report it as stopped while
            // that child is still owned by the supervisor.
            status.excel_bridge_running = bridge_running;
            if status.state == "ready" || status.state == "starting" {
                status.state = "stopped".to_string();
                status.message = "Yerel runtime kapatıldı".to_string();
            }
        }
    }

    fn discard_retained_excel_session(&self) -> Result<bool, String> {
        let context = self
            .excel_session
            .lock()
            .map_err(|_| "Excel oturumu kilitlendi".to_string())?
            .clone();
        let failed = self
            .status
            .lock()
            .map(|status| status.excel_close_failed)
            .unwrap_or(true);
        if let Some(context) = context {
            if let Err(error) = Self::discard_backend_session(&context) {
                // `discard` is the user's explicit instruction to leave even
                // when the normal save path cannot be verified.  The managed
                // bridge has already been stopped at this point, so the
                // original workbook cannot be overwritten by a late sync.
                // Preserve the working copy for recovery, record the cleanup
                // failure, and release the stale session bookkeeping instead
                // of trapping the desktop behind the close dialog forever.
                self.append_diagnostic("excel-discard-cleanup-failed", &error);
            }
            self.clear_excel_session_context();
            self.clear_excel_close_failure();
            return Ok(true);
        }
        // There is no owned bridge or retained session context left.  A
        // failed status can be stale after the bridge has already exited; an
        // explicit discard is the user's authorization to clear that native
        // bookkeeping and continue.  Do not trap logout behind a dialog for
        // a workbook that the supervisor can no longer address.
        if failed {
            self.clear_excel_close_failure();
            return Ok(true);
        }
        self.clear_excel_close_failure();
        Ok(true)
    }

    fn discard_excel_bridge(&self) -> Result<bool, String> {
        let _operation = self
            .excel_operation
            .lock()
            .map_err(|_| "Excel işlemi kilitlendi".to_string())?;
        let mut child = match self
            .excel_bridge
            .lock()
            .map_err(|_| "Excel bridge kilitlendi".to_string())?
            .take()
        {
            Some(child) => child,
            None => {
                // Explicit discard is the user-authorized escape hatch.  If
                // the bridge has already exited, use the retained session
                // context to ask the loopback backend to discard the working
                // copy; never report success merely because the child is gone.
                return self.discard_retained_excel_session();
            }
        };
        // A bridge can exit in the small window after the last status poll but
        // before this command takes ownership of its Child.  Its stdin is then
        // broken and retrying the command would strand the retained workbook;
        // use the same authenticated loopback discard fallback as the no-child
        // path instead.
        match child.try_wait() {
            Ok(Some(_)) => {
                if let Ok(mut stdin) = self.excel_stdin.lock() {
                    *stdin = None;
                }
                return self.discard_retained_excel_session();
            }
            Ok(None) => {}
            Err(error) => {
                let error = format!("Excel bridge durumu okunamadı: {error}");
                self.force_kill_excel_bridge(child);
                if let Ok(mut stdin) = self.excel_stdin.lock() {
                    *stdin = None;
                }
                self.mark_excel_close_failed(error.clone());
                return self.discard_retained_excel_session();
            }
        }
        if let Err(error) = self.send_excel_command(b"{\"action\":\"discard\"}\n") {
            let error = format!("Excel bridge iptal komutu gönderilemedi: {error}");
            // Discard is an explicit user-authorized data-loss decision.  A
            // broken pipe means the bridge cannot prove that it released
            // Excel; terminate this exact process tree, then use the
            // authenticated backend fallback to release the session.  This
            // is deliberately different from the normal save path, which
            // retains a failed bridge for a retry.
            self.force_kill_excel_bridge(child);
            if let Ok(mut stdin) = self.excel_stdin.lock() {
                *stdin = None;
            }
            self.mark_excel_close_failed(error.clone());
            return self.discard_retained_excel_session();
        }
        let deadline = Instant::now() + Duration::from_secs(EXCEL_CLOSE_TIMEOUT_SECONDS);
        loop {
            match child.try_wait() {
                Ok(Some(status)) => {
                    if let Ok(mut stdin) = self.excel_stdin.lock() {
                        *stdin = None;
                    }
                    if status.success() {
                        self.clear_excel_close_failure();
                        self.clear_excel_session_context();
                        return Ok(true);
                    }
                    self.mark_excel_close_failed(format!(
                        "Excel bridge iptal çıkış kodu: {status}"
                    ));
                    return self.discard_retained_excel_session();
                }
                Ok(None) if Instant::now() < deadline => sleep(Duration::from_millis(100)),
                Ok(None) => {
                    let error = "Excel bridge 10 saniye içinde iptal edilemedi".to_string();
                    // The user explicitly chose discard.  Do not leave a
                    // hung bridge/Excel process behind for Task Manager;
                    // force-kill only this owned process tree and then retry
                    // the authenticated idempotent backend discard.
                    self.force_kill_excel_bridge(child);
                    if let Ok(mut stdin) = self.excel_stdin.lock() {
                        *stdin = None;
                    }
                    self.mark_excel_close_failed(error.clone());
                    return self.discard_retained_excel_session();
                }
                Err(error) => {
                    let error = format!("Excel bridge durumu okunamadı: {error}");
                    self.force_kill_excel_bridge(child);
                    if let Ok(mut stdin) = self.excel_stdin.lock() {
                        *stdin = None;
                    }
                    self.mark_excel_close_failed(error.clone());
                    return self.discard_retained_excel_session();
                }
            }
        }
    }

    fn mark_excel_close_failed(&self, message: String) {
        if let Ok(mut status) = self.status.lock() {
            status.excel_close_failed = true;
            status.excel_close_error = Some(message);
        }
        if let Some(error) = self
            .status
            .lock()
            .ok()
            .and_then(|status| status.excel_close_error.clone())
        {
            self.append_diagnostic("excel-close-failed", &error);
        }
    }

    fn clear_excel_close_failure(&self) {
        if let Ok(mut status) = self.status.lock() {
            status.excel_close_failed = false;
            status.excel_close_error = None;
        }
    }

    fn clear_excel_session_context(&self) {
        if let Ok(mut session) = self.excel_session.lock() {
            *session = None;
        }
    }

    /// Explicit discard remains available even when the bridge itself died
    /// before it could receive the discard command.  The URL was validated at
    /// launch time and the token lives only in this supervisor mutex; this
    /// fallback sends one authenticated loopback DELETE and never puts the
    /// token in a command line or diagnostic message.
    fn discard_backend_session(context: &ExcelSessionContext) -> Result<(), String> {
        #[cfg(target_os = "windows")]
        {
            let prefix = "http://127.0.0.1:8100";
            let path = context
                .close_url
                .strip_prefix(prefix)
                .filter(|value| value.starts_with("/api/v2/excel-sessions/"))
                .ok_or_else(|| "Excel oturum adresi yalnız yerel backend olabilir".to_string())?;
            let mut stream = TcpStream::connect_timeout(
                &"127.0.0.1:8100"
                    .parse()
                    .map_err(|_| "Yerel backend adresi geçersiz".to_string())?,
                Duration::from_secs(8),
            )
            .map_err(|_| "Excel oturumu backend'e bildirilemedi".to_string())?;
            stream
                .set_read_timeout(Some(Duration::from_secs(8)))
                .map_err(|_| "Excel oturumu backend'e bildirilemedi".to_string())?;
            stream
                .set_write_timeout(Some(Duration::from_secs(8)))
                .map_err(|_| "Excel oturumu backend'e bildirilemedi".to_string())?;
            let request = format!(
                "DELETE {path}?discard=true HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer {}\r\nConnection: close\r\n\r\n",
                context.session_token
            );
            stream
                .write_all(request.as_bytes())
                .map_err(|_| "Excel oturumu backend'e bildirilemedi".to_string())?;
            let mut response = String::new();
            stream
                .read_to_string(&mut response)
                .map_err(|_| "Excel oturumu backend yanıtı okunamadı".to_string())?;
            // A discard can race a bridge that already completed its DELETE;
            // treat the now-missing session as the same idempotent success as
            // the first request.  This keeps a timed-out discard retryable
            // without requiring the user to kill the desktop process.
            let success = response
                .lines()
                .next()
                .and_then(|line| line.split_whitespace().nth(1))
                .and_then(|value| value.parse::<u16>().ok())
                .map(|code| (200..300).contains(&code) || code == 404 || code == 410)
                .unwrap_or(false);
            if success {
                Ok(())
            } else {
                Err("Excel oturumu backend tarafından iptal edilemedi".to_string())
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = context;
            Err("Excel oturumu iptali yalnızca Windows üzerinde desteklenir".to_string())
        }
    }

    fn restore_excel_bridge(&self, child: Child) {
        if let Ok(mut bridge) = self.excel_bridge.lock() {
            *bridge = Some(child);
        }
    }

    /// Terminate one owned bridge and its Excel child tree after the user has
    /// explicitly selected discard.  The normal save path never calls this:
    /// an uncertain save keeps the bridge recoverable for Retry.  `taskkill`
    /// is scoped to the bridge PID and `/T` catches the COM-launched Excel
    /// child, while the Rust `Child` handle is still waited before returning.
    fn force_kill_excel_bridge(&self, mut child: Child) {
        let pid = child.id();
        #[cfg(target_os = "windows")]
        {
            let pid_text = pid.to_string();
            let mut command = Command::new("taskkill.exe");
            command
                .args(["/PID", pid_text.as_str(), "/T", "/F"])
                .creation_flags(0x08000000);
            let _ = command.output();
        }
        let _ = child.kill();
        let _ = child.wait();
        self.append_diagnostic(
            "excel-discard-forced",
            &format!("Excel bridge process {pid} sonlandırıldı"),
        );
    }

    fn send_excel_command(&self, command: &[u8]) -> Result<(), String> {
        let mut guard = self
            .excel_stdin
            .lock()
            .map_err(|_| "Excel bridge stdin kilitlendi".to_string())?;
        let stdin = guard
            .as_mut()
            .ok_or_else(|| "Excel bridge stdin bulunamadı".to_string())?;
        stdin
            .write_all(command)
            .and_then(|_| stdin.flush())
            .map_err(|error| error.to_string())
    }
}

struct SpawnedRuntime {
    child: Child,
    stdin: Option<ChildStdin>,
}

impl Drop for RuntimeSupervisor {
    fn drop(&mut self) {
        self.shutdown();
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct ExcelBridgeRequest {
    workbook_path: String,
    sync_url: String,
    close_url: Option<String>,
    session_token: String,
    base_revision: i64,
    can_write: bool,
}

#[derive(Debug, Serialize, Clone)]
struct ExcelBridgeStatus {
    running: bool,
    pid: Option<u32>,
    message: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct ExcelComProbeResult {
    available: bool,
    version: Option<String>,
    error: Option<String>,
    confidence: String,
}

impl RuntimeSupervisor {
    /// Gerçek COM tespiti: runtime'ı `excel-probe` modunda çalıştırır.
    /// Registry sezgisinin aksine "kayıtlı ama bozuk" Office kurulumlarını
    /// da yakalar. Soğuk COM başlangıcı saniyeler sürebilir; 15 sn bekler.
    fn probe_excel_com(&self, app: &AppHandle) -> Result<ExcelComProbeResult, String> {
        let _operation = self
            .excel_operation
            .lock()
            .map_err(|_| "Excel işlemi kilitlendi".to_string())?;
        let runtime = self
            .runtime_path(app)
            .ok_or_else(|| format!("Paketlenmiş runtime bulunamadı: {RUNTIME_RELATIVE_PATH}"))?;
        let paths = self.paths()?;
        self.ensure_job()?;
        let mut command = Command::new(&runtime);
        command
            .arg("excel-probe")
            .current_dir(&paths.root)
            .env("SEROGULD_PROGRAM_DATA", &paths.root)
            .env("PYTHONUNBUFFERED", "1")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        #[cfg(target_os = "windows")]
        command.creation_flags(0x08000000);
        let mut child = command
            .spawn()
            .map_err(|error| format!("excel-probe başlatılamadı: {error}"))?;
        if let Some(job) = self
            .job
            .lock()
            .map_err(|_| "Runtime Job Object kilitlendi".to_string())?
            .as_ref()
        {
            let _ = job.assign(&child);
        }
        let deadline = Instant::now() + Duration::from_secs(15);
        loop {
            match child.try_wait() {
                Ok(Some(_status)) => break,
                Ok(None) => {
                    if Instant::now() >= deadline {
                        let _ = child.kill();
                        let _ = child.wait();
                        return Err("Excel COM tespiti zaman aşımına uğradı".to_string());
                    }
                    sleep(Duration::from_millis(150));
                }
                Err(error) => return Err(format!("excel-probe izlenemedi: {error}")),
            }
        }
        let mut output = String::new();
        if let Some(mut stdout) = child.stdout.take() {
            use std::io::Read;
            let _ = stdout.read_to_string(&mut output);
        }
        let line = output
            .lines()
            .rev()
            .find(|line| line.trim_start().starts_with('{'))
            .ok_or_else(|| "excel-probe çıktı vermedi".to_string())?;
        let mut verdict: ExcelComProbeResult = serde_json::from_str(line.trim())
            .map_err(|error| format!("excel-probe çıktısı çözümlenemedi: {error}"))?;
        verdict.confidence = "com".to_string();
        if let Ok(mut cache) = self.excel_probe_cache.lock() {
            *cache = Some(verdict.clone());
        }
        Ok(verdict)
    }
}

#[derive(Debug, Serialize, Clone)]
struct ExcelAvailability {
    available: bool,
    executable: Option<String>,
    reason: Option<String>,
}

#[cfg(target_os = "windows")]
fn registry_executable(raw: &str) -> String {
    let value = raw.trim();
    if let Some(rest) = value.strip_prefix('"') {
        return rest
            .split_once('"')
            .map(|(path, _)| path)
            .unwrap_or(rest)
            .trim()
            .to_string();
    }
    // `reg.exe` returns directory values such as Click-to-Run's
    // InstallationPath without quoting them.  Splitting every unquoted value
    // on whitespace would turn `C:\Program Files\...` into `C:\Program` and
    // make a perfectly valid custom Office install invisible.  For command
    // lines, stop at the executable suffix; for directory values retain the
    // complete path.
    let lower = value.to_ascii_lowercase();
    if let Some(end) = lower.find(".exe") {
        return value[..end + 4].trim_matches('"').to_string();
    }
    value.trim_matches('"').to_string()
}

#[cfg(target_os = "windows")]
fn registry_value_text(line: &str) -> Option<&str> {
    // `reg query` can print either REG_SZ or REG_EXPAND_SZ.  Check the longer
    // marker first so the latter is not accidentally parsed as a plain value.
    ["REG_EXPAND_SZ", "REG_SZ"]
        .into_iter()
        .find_map(|marker| line.split_once(marker).map(|(_, value)| value.trim()))
}

#[cfg(target_os = "windows")]
fn excel_available() -> ExcelAvailability {
    let mut candidates = Vec::new();
    for variable in ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"] {
        if let Some(root) = env::var_os(variable) {
            let root = PathBuf::from(root);
            candidates.push(root.join("Microsoft Office/root/Office16/EXCEL.EXE"));
            candidates.push(root.join("Microsoft Office/Office16/EXCEL.EXE"));
        }
    }
    for query in [
        // ProgID -> CLSID is a two-step registry lookup.  Querying
        // `...\\CLSID\\LocalServer32` directly is not a valid ProgID path.
        ("HKCR\\Excel.Application\\CLSID", ""),
        ("HKCR\\Excel.Application.16\\CLSID", ""),
        (
            "HKLM\\SOFTWARE\\Microsoft\\Office\\ClickToRun\\Configuration",
            "InstallationPath",
        ),
        (
            "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\EXCEL.EXE",
            "",
        ),
    ] {
        let mut command = Command::new("reg.exe");
        command.args(["query", query.0]);
        if !query.1.is_empty() {
            command.args(["/v", query.1]);
        }
        command.creation_flags(0x08000000);
        if let Ok(output) = command.output() {
            let text = String::from_utf8_lossy(&output.stdout);
            for line in text.lines() {
                let value = registry_value_text(line)
                    .map(|value| value.trim().trim_matches('"').to_string());
                if let Some(value) = value {
                    let executable = registry_executable(&value);
                    let path = PathBuf::from(&executable);
                    if path.is_file() {
                        candidates.push(path);
                    } else if path.is_dir() {
                        candidates.push(path.join("root").join("Office16").join("EXCEL.EXE"));
                        candidates.push(path.join("Office16").join("EXCEL.EXE"));
                    } else if query.0.ends_with("\\CLSID") {
                        // The default ProgID value is the CLSID. Resolve its
                        // LocalServer32 default value, then parse the quoted
                        // executable path (which may have /automation args).
                        let clsid = executable.trim_matches('{').trim_matches('}');
                        if !clsid.is_empty() {
                            let local_server = format!("HKCR\\CLSID\\{{{clsid}}}\\LocalServer32");
                            let mut server_query = Command::new("reg.exe");
                            server_query.args(["query", &local_server]);
                            server_query.creation_flags(0x08000000);
                            if let Ok(server_output) = server_query.output() {
                                let server_text = String::from_utf8_lossy(&server_output.stdout);
                                for server_line in server_text.lines() {
                                    if let Some(raw) = registry_value_text(server_line) {
                                        let executable = registry_executable(raw);
                                        let path = PathBuf::from(executable);
                                        if path.is_file() {
                                            candidates.push(path);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    if let Some(path) = candidates.into_iter().find(|path| path.is_file()) {
        return ExcelAvailability {
            available: true,
            executable: Some(path.display().to_string()),
            reason: None,
        };
    }
    ExcelAvailability {
        available: false,
        executable: None,
        reason: Some("Microsoft Excel kurulum yolu bulunamadı".to_string()),
    }
}

/// Resolve the backend's relative `<session-id>/<working-file-name>` contract
/// into a file below ProgramData.  The UI never gets to choose an arbitrary
/// absolute path, and traversal components are rejected before filesystem
/// access.  Canonicalization closes the remaining symlink/junction escape.
fn resolve_managed_excel_path(paths: &DesktopPaths, requested: &str) -> Result<PathBuf, String> {
    if requested.is_empty() || requested.contains('\0') {
        return Err("Excel çalışma yolu boş veya geçersiz".to_string());
    }
    let path = PathBuf::from(requested);
    if path.is_absolute() {
        return Err("Excel çalışma yolu mutlak olamaz".to_string());
    }
    let components: Vec<_> = path.components().collect();
    if components.len() != 2 {
        return Err("Excel çalışma yolu session-id/dosya adı biçiminde olmalıdır".to_string());
    }
    let session = match components[0] {
        std::path::Component::Normal(value) => value.to_string_lossy().to_string(),
        _ => return Err("Excel session kimliği geçersiz".to_string()),
    };
    let file_name = match components[1] {
        std::path::Component::Normal(value) => value.to_string_lossy().to_string(),
        _ => return Err("Excel dosya adı geçersiz".to_string()),
    };
    if session.is_empty()
        || !session
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, '-' | '_'))
        || file_name.is_empty()
        || file_name == "."
        || file_name == ".."
    {
        return Err("Excel çalışma yolu güvenli değil".to_string());
    }

    let working_root = paths.root.join("documents").join("working");
    let candidate = working_root.join(&session).join(&file_name);
    let canonical_root = working_root
        .canonicalize()
        .map_err(|error| format!("Excel çalışma alanı okunamadı: {error}"))?;
    let canonical_candidate = candidate
        .canonicalize()
        .map_err(|error| format!("Excel çalışma kopyası bulunamadı: {error}"))?;
    if !canonical_candidate.starts_with(&canonical_root) || !canonical_candidate.is_file() {
        return Err("Excel çalışma kopyası çalışma alanı dışında".to_string());
    }
    Ok(canonical_candidate)
}

#[cfg(not(target_os = "windows"))]
fn excel_available() -> ExcelAvailability {
    ExcelAvailability {
        available: false,
        executable: None,
        reason: Some("Excel bridge yalnızca Windows üzerinde desteklenir".to_string()),
    }
}

#[derive(Debug, Serialize, Clone)]
struct MonitorInfo {
    id: String,
    name: String,
    width: u32,
    height: u32,
    x: i32,
    y: i32,
    scale_factor: f64,
    primary: bool,
    current: bool,
    selected: bool,
}

#[derive(Debug, Serialize, Clone)]
struct DisplayWindowState {
    has_secondary_monitor: bool,
    monitors: Vec<MonitorInfo>,
    preferred_monitor_id: Option<String>,
    resolved_monitor_id: Option<String>,
    selection_source: String,
    secondary_monitor: Option<MonitorInfo>,
    active_route: String,
    window_open: bool,
    display_enabled: bool,
}

#[derive(Debug, Deserialize, Serialize, Clone, Default)]
struct DisplayMonitorPreference {
    id: String,
    name: String,
    width: u32,
    height: u32,
    x: i32,
    y: i32,
    scale_factor: f64,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
struct CustomerDisplaySettings {
    version: u8,
    preferred_monitor: Option<DisplayMonitorPreference>,
    #[serde(default = "default_customer_display_enabled")]
    enabled: bool,
}

fn default_customer_display_enabled() -> bool {
    true
}

impl Default for CustomerDisplaySettings {
    fn default() -> Self {
        Self {
            version: 1,
            preferred_monitor: None,
            enabled: true,
        }
    }
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

#[cfg(target_os = "linux")]
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
    let mut command = Command::new("powershell.exe");
    command
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            script,
        ])
        .arg(path)
        // WIA/OCR are implementation details of the scanner.  Neither
        // PowerShell nor its transient script window may flash above the
        // customer-facing desktop.
        .creation_flags(0x08000000);
    command.output().map_err(|_| ())
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
    // A fullscreen window keeps its old monitor affinity on Windows.  Reset
    // it before moving so a saved monitor preference is honored after a
    // hot-plug or a display-layout change.
    let _ = window.hide();
    let _ = window.set_fullscreen(false);
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

fn display_settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join(DISPLAY_SETTINGS_FILE))
}

fn load_customer_display_settings(app: &AppHandle) -> CustomerDisplaySettings {
    let Ok(path) = display_settings_path(app) else {
        return CustomerDisplaySettings::default();
    };
    fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<CustomerDisplaySettings>(&bytes).ok())
        .filter(|settings| settings.version <= 1)
        .unwrap_or_default()
}

fn save_customer_display_settings(
    app: &AppHandle,
    settings: &CustomerDisplaySettings,
) -> Result<(), String> {
    let path = display_settings_path(app)?;
    let directory = path
        .parent()
        .ok_or_else(|| "Müşteri ekranı ayar klasörü bulunamadı".to_string())?;
    fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    let temporary = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec_pretty(settings).map_err(|error| error.to_string())?;
    fs::write(&temporary, bytes).map_err(|error| error.to_string())?;
    if path.exists() {
        fs::remove_file(&path).map_err(|error| error.to_string())?;
    }
    fs::rename(temporary, path).map_err(|error| error.to_string())
}

fn monitor_id(monitor: &tauri::Monitor) -> String {
    monitor.name().cloned().unwrap_or_else(|| {
        let position = monitor.position();
        let size = monitor.size();
        format!(
            "monitor:{}:{}:{}:{}",
            position.x, position.y, size.width, size.height
        )
    })
}

fn monitor_info(
    monitor: &tauri::Monitor,
    current_position: &PhysicalPosition<i32>,
    primary_position: Option<&PhysicalPosition<i32>>,
    preference: Option<&DisplayMonitorPreference>,
) -> MonitorInfo {
    let position = monitor.position();
    let size = monitor.size();
    let id = monitor_id(monitor);
    let name = monitor
        .name()
        .cloned()
        .unwrap_or_else(|| "Ekran".to_string());
    let current = position.x == current_position.x && position.y == current_position.y;
    let selected = preference
        .map(|saved| saved.id == id || (saved.id.is_empty() && saved.name == name))
        .unwrap_or(false);
    MonitorInfo {
        id,
        name,
        width: size.width,
        height: size.height,
        x: position.x,
        y: position.y,
        scale_factor: monitor.scale_factor(),
        primary: primary_position
            .map(|primary| primary.x == position.x && primary.y == position.y)
            .unwrap_or(false),
        current,
        selected,
    }
}

fn monitor_setup_snapshot(
    app: &AppHandle,
) -> Result<
    (
        Vec<MonitorInfo>,
        Option<MonitorInfo>,
        Option<String>,
        String,
    ),
    String,
> {
    let main_window = app
        .get_webview_window("main")
        .ok_or_else(|| "Ana pencere bulunamadı".to_string())?;
    let monitors = main_window
        .available_monitors()
        .map_err(|error| error.to_string())?;

    let current_monitor = main_window
        .current_monitor()
        .map_err(|error| error.to_string())?;
    let current_position = current_monitor
        .as_ref()
        .map(|monitor| monitor.position().clone())
        .unwrap_or(PhysicalPosition { x: 0, y: 0 });
    let primary_position = main_window
        .primary_monitor()
        .map_err(|error| error.to_string())?
        .map(|monitor| monitor.position().clone());
    let settings = load_customer_display_settings(app);
    let preference = settings.preferred_monitor.as_ref();
    let mut infos: Vec<MonitorInfo> = monitors
        .iter()
        .map(|monitor| {
            monitor_info(
                monitor,
                &current_position,
                primary_position.as_ref(),
                preference,
            )
        })
        .collect();
    let preferred_id = preference.map(|saved| saved.id.clone());
    let saved_index = preferred_id.as_ref().and_then(|id| {
        infos
            .iter()
            .position(|monitor| !monitor.current && monitor.id == *id)
    });
    let fallback_index = infos.iter().position(|monitor| !monitor.current);
    let resolved_index = saved_index.or(fallback_index);
    let source = if resolved_index.is_none() {
        "unavailable"
    } else if saved_index.is_some() {
        "saved"
    } else if preferred_id.is_some() {
        "fallback"
    } else {
        "automatic"
    };
    for (index, monitor) in infos.iter_mut().enumerate() {
        monitor.selected = resolved_index == Some(index);
    }
    let secondary = resolved_index.and_then(|index| infos.get(index).cloned());
    Ok((infos, secondary, preferred_id, source.to_string()))
}

fn state_payload(app: &AppHandle, route: &str) -> Result<DisplayWindowState, String> {
    let (monitors, secondary_monitor, preferred_monitor_id, selection_source) =
        monitor_setup_snapshot(app)?;
    let settings = load_customer_display_settings(app);
    Ok(DisplayWindowState {
        has_secondary_monitor: secondary_monitor.is_some(),
        monitors,
        preferred_monitor_id,
        resolved_monitor_id: secondary_monitor.as_ref().map(|monitor| monitor.id.clone()),
        selection_source,
        secondary_monitor,
        active_route: normalize_display_route(route),
        window_open: app
            .get_webview_window(DISPLAY_WINDOW_LABEL)
            .and_then(|window| window.is_visible().ok())
            .unwrap_or(false),
        display_enabled: settings.enabled,
    })
}

#[tauri::command]
async fn get_monitor_setup(app: AppHandle) -> Result<DisplayWindowState, String> {
    state_payload(&app, DISPLAY_IDLE_ROUTE)
}

#[tauri::command]
async fn set_customer_display_monitor(
    app: AppHandle,
    monitor_id: String,
    route: Option<String>,
) -> Result<DisplayWindowState, String> {
    let (monitors, _, _, _) = monitor_setup_snapshot(&app)?;
    let selected = monitors
        .into_iter()
        .find(|monitor| monitor.id == monitor_id && !monitor.current)
        .ok_or_else(|| "Bu monitör müşteri ekranı için kullanılamıyor".to_string())?;
    let mut settings = load_customer_display_settings(&app);
    settings.version = 1;
    settings.preferred_monitor = Some(DisplayMonitorPreference {
        id: selected.id.clone(),
        name: selected.name.clone(),
        width: selected.width,
        height: selected.height,
        x: selected.x,
        y: selected.y,
        scale_factor: selected.scale_factor,
    });
    save_customer_display_settings(&app, &settings)?;
    let route = normalize_display_route(route.as_deref().unwrap_or(DISPLAY_IDLE_ROUTE));
    if let Some(window) = app.get_webview_window(DISPLAY_WINDOW_LABEL) {
        if window.is_visible().unwrap_or(false) {
            show_customer_display_window(&window, &route, &selected, false)?;
        }
    }
    state_payload(&app, &route)
}

#[tauri::command]
async fn ensure_customer_display_window(
    app: AppHandle,
    route: Option<String>,
) -> Result<DisplayWindowState, String> {
    let route = normalize_display_route(route.as_deref().unwrap_or(DISPLAY_IDLE_ROUTE));
    if !load_customer_display_settings(&app).enabled {
        return state_payload(&app, &route);
    }
    let (_, secondary_monitor, _, _) = monitor_setup_snapshot(&app)?;
    let secondary_monitor = match secondary_monitor {
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
async fn open_customer_display_window(
    app: AppHandle,
    route: Option<String>,
) -> Result<DisplayWindowState, String> {
    let mut settings = load_customer_display_settings(&app);
    settings.version = 1;
    settings.enabled = true;
    save_customer_display_settings(&app, &settings)?;
    ensure_customer_display_window(app, route).await
}

#[tauri::command]
async fn close_or_idle_customer_display(
    app: AppHandle,
    ui_variant: Option<String>,
    route: Option<String>,
) -> Result<DisplayWindowState, String> {
    let route = route
        .as_deref()
        .map(normalize_display_route)
        .unwrap_or_else(|| display_idle_route_for_variant(ui_variant.as_deref()));
    if let Some(window) = app.get_webview_window(DISPLAY_WINDOW_LABEL) {
        best_effort_navigate_window_to_route(&window, &route);
        let _ = window.set_fullscreen(false);
        let _ = window.hide();
    }
    state_payload(&app, &route)
}

#[tauri::command]
async fn close_customer_display_window(
    app: AppHandle,
    ui_variant: Option<String>,
) -> Result<DisplayWindowState, String> {
    let route = display_idle_route_for_variant(ui_variant.as_deref());
    let mut settings = load_customer_display_settings(&app);
    settings.version = 1;
    settings.enabled = false;
    save_customer_display_settings(&app, &settings)?;
    if let Some(window) = app.get_webview_window(DISPLAY_WINDOW_LABEL) {
        best_effort_navigate_window_to_route(&window, &route);
        let _ = window.set_fullscreen(false);
        let _ = window.hide();
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

#[tauri::command]
fn get_desktop_startup_state(state: State<'_, RuntimeSupervisor>) -> RuntimeStatus {
    state.snapshot()
}

/// Consume a native X-button request that may have arrived before React's
/// event listener finished mounting. Registering the listener first and then
/// consuming this flag closes both sides of that race.
#[tauri::command]
fn consume_desktop_close_request(state: State<'_, RuntimeSupervisor>) -> bool {
    state.close_request_pending.swap(false, Ordering::AcqRel)
}

#[tauri::command]
fn retry_desktop_startup(app: AppHandle, state: State<'_, RuntimeSupervisor>) -> RuntimeStatus {
    if state.start_in_progress.load(Ordering::Acquire) {
        return state.snapshot();
    }
    state.shutdown();
    state.close_confirmed.store(false, Ordering::Release);
    state.set_status("starting", "Yerel runtime yeniden başlatılıyor");
    let app_handle = app.clone();
    std::thread::spawn(move || {
        let state = app_handle.state::<RuntimeSupervisor>();
        state.start(&app_handle);
    });
    state.snapshot()
}

#[tauri::command]
fn open_runtime_diagnostics(state: State<'_, RuntimeSupervisor>) -> Result<String, String> {
    let paths = state.paths()?;
    let target = paths.logs;
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer.exe")
            .arg(&target)
            .spawn()
            .map_err(|error| format!("Tanı klasörü açılamadı: {error}"))?;
    }
    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(&target)
            .spawn()
            .map_err(|error| format!("Tanı klasörü açılamadı: {error}"))?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&target)
            .spawn()
            .map_err(|error| format!("Tanı klasörü açılamadı: {error}"))?;
    }
    Ok(target.display().to_string())
}

#[tauri::command]
fn probe_excel_com_availability(
    app: AppHandle,
    state: State<'_, RuntimeSupervisor>,
    force: Option<bool>,
) -> Result<ExcelComProbeResult, String> {
    if !force.unwrap_or(false) {
        if let Ok(cache) = state.excel_probe_cache.lock() {
            if let Some(cached) = cache.as_ref() {
                return Ok(cached.clone());
            }
        }
    }
    #[cfg(target_os = "windows")]
    {
        return state.probe_excel_com(&app);
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        Ok(ExcelComProbeResult {
            available: false,
            version: None,
            error: Some("Excel bridge yalnızca Windows üzerinde desteklenir".to_string()),
            confidence: "unsupported".to_string(),
        })
    }
}

#[tauri::command]
fn get_excel_availability() -> ExcelAvailability {
    excel_available()
}

#[tauri::command]
fn launch_excel_bridge(
    app: AppHandle,
    state: State<'_, RuntimeSupervisor>,
    request: ExcelBridgeRequest,
) -> Result<ExcelBridgeStatus, String> {
    let result = state.launch_excel_bridge(&app, request);
    if let Err(error) = &result {
        // Keep native launch failures in the technical desktop log.  The
        // error paths intentionally contain no bearer token or workbook bytes.
        state.append_diagnostic("excel-launch-failed", error);
    }
    result
}

#[tauri::command]
fn close_managed_excel_session(
    state: State<'_, RuntimeSupervisor>,
) -> Result<ExcelBridgeStatus, String> {
    let closed = state.close_excel_bridge()?;
    if !closed {
        return Err("Excel bridge son kaydı başarıyla tamamlayamadı".to_string());
    }
    Ok(ExcelBridgeStatus {
        running: false,
        pid: None,
        message: "Excel bridge kapatıldı".to_string(),
    })
}

/// Explicit user-authorized escape hatch for a failed/hung Excel save.  The
/// supervisor force-terminates only the owned bridge tree when necessary and
/// confirms the authenticated backend discard before resolving.
#[tauri::command]
fn discard_managed_excel_session(
    state: State<'_, RuntimeSupervisor>,
) -> Result<ExcelBridgeStatus, String> {
    let discarded = state.discard_excel_bridge()?;
    if !discarded {
        return Err("Excel bridge değişiklikleri iptal edemedi".to_string());
    }
    Ok(ExcelBridgeStatus {
        running: false,
        pid: None,
        message: "Excel bridge değişiklikleri iptal edildi".to_string(),
    })
}

#[tauri::command]
fn show_managed_excel_session(
    state: State<'_, RuntimeSupervisor>,
) -> Result<ExcelBridgeStatus, String> {
    state.focus_excel_bridge()?;
    Ok(ExcelBridgeStatus {
        running: true,
        pid: None,
        message: "Yönetilen Excel penceresi öne getiriliyor".to_string(),
    })
}

/// Compatibility alias used by the embedded workbook conflict dialog.  Keep
/// both command names while older frontend bundles are still in circulation.
#[tauri::command]
fn focus_managed_excel_session(
    state: State<'_, RuntimeSupervisor>,
) -> Result<ExcelBridgeStatus, String> {
    show_managed_excel_session(state)
}

#[tauri::command]
fn confirm_desktop_close(
    app: AppHandle,
    state: State<'_, RuntimeSupervisor>,
    discard_changes: bool,
) -> Result<bool, String> {
    let snapshot = state.snapshot();
    if !discard_changes && (snapshot.excel_bridge_running || snapshot.excel_close_failed) {
        if !state.close_excel_bridge()? {
            return Err("Excel bridge son kaydı doğrulayamadı; belge açık bırakıldı".to_string());
        }
    } else if discard_changes {
        // "Kaydetmeden çık" is the operator's explicit escape hatch.  The
        // best-effort discard normally releases the backend session, but a
        // stale bridge/backend must never force the user to use Task Manager.
        // `shutdown` below closes the owned Job Object and therefore still
        // terminates this application's runtime/bridge process tree.
        if !matches!(state.discard_excel_bridge(), Ok(true)) {
            state.append_diagnostic(
                "excel-discard-on-close-incomplete",
                "Explicit discard cleanup did not complete before owned-process shutdown",
            );
        }
    }
    state.close_confirmed.store(true, Ordering::Release);
    state.shutdown();
    app.exit(0);
    Ok(true)
}

#[cfg(target_os = "windows")]
fn credential_entry(target: &str) -> Result<keyring_core::Entry, String> {
    let target = target.trim();
    let Some(email) = target.strip_prefix("dk.seroguld.crm/login/") else {
        return Err("Geçersiz Credential Manager hedefi".to_string());
    };
    if normalize_login_email(email).ok().as_deref() != Some(email) {
        return Err("Geçersiz Credential Manager hedefi".to_string());
    }
    if let Err(error) = keyring::v1::Entry::store_status() {
        return Err(format!("Windows Credential Manager kullanılamadı: {error}"));
    }
    let modifiers = HashMap::from([("target", target), ("persistence", "Local")]);
    keyring_core::Entry::new_with_modifiers(KEYRING_SERVICE, target, &modifiers)
        .map_err(|error| format!("Windows Credential Manager kullanılamadı: {error}"))
}

fn normalize_login_email(value: &str) -> Result<String, String> {
    let email = value.trim().to_lowercase();
    let mut parts = email.split('@');
    let local = parts.next().unwrap_or_default();
    let domain = parts.next().unwrap_or_default();
    if parts.next().is_some()
        || local.is_empty()
        || domain.is_empty()
        || email.len() > 254
        || email.chars().any(|character| {
            character.is_control() || character.is_whitespace() || matches!(character, '/' | '\\')
        })
    {
        return Err("Geçersiz Credential Manager e-postası".to_string());
    }
    Ok(email)
}

fn normalize_keyring_target(
    target: Option<String>,
    email: Option<String>,
) -> Result<String, String> {
    if let Some(target) = target.filter(|value| !value.trim().is_empty()) {
        let target = target.trim();
        let email = target
            .strip_prefix("dk.seroguld.crm/login/")
            .ok_or_else(|| "Geçersiz Credential Manager hedefi".to_string())?;
        let normalized_email = normalize_login_email(email)?;
        if normalized_email != email {
            return Err("Geçersiz Credential Manager hedefi".to_string());
        }
        return Ok(format!("dk.seroguld.crm/login/{normalized_email}"));
    }
    let email = normalize_login_email(&email.unwrap_or_default())?;
    Ok(format!("dk.seroguld.crm/login/{email}"))
}

fn validate_excel_bridge_urls(
    request: &ExcelBridgeRequest,
    session_id: &str,
) -> Result<(), String> {
    let expected_prefix = format!("http://127.0.0.1:8100/api/v2/excel-sessions/{session_id}");
    let sync = request.sync_url.trim();
    if sync != format!("{expected_prefix}/sync") {
        return Err("Excel senkron adresi yerel oturum adresiyle eşleşmiyor".to_string());
    }
    let close = request
        .close_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Excel kapanış adresi gerekli".to_string())?;
    if close != expected_prefix {
        return Err("Excel kapanış adresi yerel oturum adresiyle eşleşmiyor".to_string());
    }
    Ok(())
}

#[tauri::command]
fn keyring_get(target: Option<String>, email: Option<String>) -> Result<Option<String>, String> {
    let target = normalize_keyring_target(target, email)?;
    #[cfg(target_os = "windows")]
    {
        let entry = credential_entry(&target)?;
        return match entry.get_password() {
            Ok(password) if !password.is_empty() => Ok(Some(password)),
            Ok(_) => Ok(None),
            Err(keyring_core::Error::NoEntry) => Ok(None),
            Err(error) => Err(format!("Credential Manager okunamadı: {error}")),
        };
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = target;
        Ok(None)
    }
}

#[tauri::command]
fn keyring_set(
    target: Option<String>,
    email: Option<String>,
    password: String,
) -> Result<(), String> {
    let target = normalize_keyring_target(target, email)?;
    #[cfg(target_os = "windows")]
    {
        if password.is_empty() {
            return Err("Şifre boş olamaz".to_string());
        }
        return credential_entry(&target)?
            .set_password(&password)
            .map_err(|error| format!("Şifre Credential Manager'a kaydedilemedi: {error}"));
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (target, password);
        Err("Windows Credential Manager yalnızca Windows üzerinde desteklenir".to_string())
    }
}

#[tauri::command]
fn keyring_delete(target: Option<String>, email: Option<String>) -> Result<(), String> {
    let target = normalize_keyring_target(target, email)?;
    #[cfg(target_os = "windows")]
    {
        let entry = credential_entry(&target)?;
        return match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring_core::Error::NoEntry) => Ok(()),
            Err(error) => Err(format!("Şifre Credential Manager'dan silinemedi: {error}")),
        };
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = target;
        Ok(())
    }
}

#[cfg(target_os = "windows")]
#[derive(Debug, Deserialize)]
struct BootstrapStateResponse {
    initial_login_pending: bool,
}

#[cfg(target_os = "windows")]
fn backend_bootstrap_is_pending() -> bool {
    const BOOTSTRAP_STATE_PATH: &[u8] =
        b"GET /api/auth/bootstrap-state HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n";
    const MAX_RESPONSE_BYTES: usize = 64 * 1024;
    let address = "127.0.0.1:8100";
    let Ok(mut stream) = TcpStream::connect_timeout(
        &address.parse().expect("local backend address"),
        Duration::from_secs(2),
    ) else {
        return false;
    };
    let timeout = Some(Duration::from_secs(2));
    let _ = stream.set_read_timeout(timeout);
    let _ = stream.set_write_timeout(timeout);
    if stream.write_all(BOOTSTRAP_STATE_PATH).is_err() {
        return false;
    }

    let mut response = Vec::with_capacity(4096);
    let mut chunk = [0u8; 4096];
    while response.len() < MAX_RESPONSE_BYTES {
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(read) => {
                let remaining = MAX_RESPONSE_BYTES - response.len();
                response.extend_from_slice(&chunk[..read.min(remaining)]);
                if read > remaining {
                    return false;
                }
            }
            Err(_) => return false,
        }
    }
    let Some(body) = response
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .map(|index| &response[index + 4..])
    else {
        return false;
    };
    if !(response.starts_with(b"HTTP/1.1 200") || response.starts_with(b"HTTP/1.0 200")) {
        return false;
    }
    serde_json::from_slice::<BootstrapStateResponse>(body)
        .map(|state| state.initial_login_pending)
        .unwrap_or(false)
}

#[cfg(not(target_os = "windows"))]
fn backend_bootstrap_is_pending() -> bool {
    false
}

#[tauri::command]
fn get_bootstrap_login_password() -> Option<String> {
    if cfg!(debug_assertions) {
        return None;
    }
    // Ask the local backend for its one-time bootstrap state.  A release
    // upgrade, an unavailable backend, malformed data, or any non-200 reply
    // must never receive the fallback password.  The password is returned
    // only to the already-running frontend and is never logged or put on a
    // process command line.
    if !backend_bootstrap_is_pending() {
        return None;
    }
    #[cfg(target_os = "windows")]
    {
        Some("admin".to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        None
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            let supervisor = RuntimeSupervisor::new();
            app.manage(supervisor);
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                let state = app_handle.state::<RuntimeSupervisor>();
                state.start(&app_handle);
            });
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
            set_customer_display_monitor,
            ensure_customer_display_window,
            open_customer_display_window,
            close_or_idle_customer_display,
            close_customer_display_window,
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
            pending_purchase_draft::delete_pending_purchase_draft,
            get_desktop_startup_state,
            consume_desktop_close_request,
            retry_desktop_startup,
            open_runtime_diagnostics,
            get_excel_availability,
            probe_excel_com_availability,
            launch_excel_bridge,
            show_managed_excel_session,
            focus_managed_excel_session,
            close_managed_excel_session,
            discard_managed_excel_session,
            confirm_desktop_close,
            keyring_get,
            keyring_set,
            keyring_delete,
            get_bootstrap_login_password,
            backup::get_backup_native_config,
            backup::choose_backup_destination,
            backup::open_backup_destination,
            backup::export_backup_recovery_key,
            backup::import_backup_recovery_key,
            backup::encrypt_backup_snapshot,
            backup::pick_backup_for_restore,
            backup::decrypt_backup_for_restore
        ])
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            if let WindowEvent::CloseRequested { api, .. } = event {
                let state = window.app_handle().state::<RuntimeSupervisor>();
                if state.close_confirmed.load(Ordering::Acquire) {
                    state.shutdown();
                    return;
                }
                api.prevent_close();
                state.close_request_pending.store(true, Ordering::Release);
                let snapshot = state.snapshot();
                let _ = window.emit("desktop-close-requested", snapshot.clone());
                let _ = window.emit("desktop-close-confirmation", snapshot);
            }
        })
        .run(tauri::generate_context!())
        .expect("failed to start tauri application");
}
