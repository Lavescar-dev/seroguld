use aes_gcm::{
    aead::{Aead, Payload},
    Aes256Gcm, KeyInit, Nonce,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use keyring_core::{Entry, Error as KeyringError};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::env;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use zeroize::Zeroize;

const MAGIC: &[u8; 8] = b"SGBAK001";
const CHUNK_SIZE: usize = 1024 * 1024;
const KEY_SERVICE: &str = "dk.seroguld.crm";
const KEY_ACCOUNT: &str = "backup/master-key";
#[cfg(target_os = "windows")]
const KEY_TARGET: &str = "dk.seroguld.crm/backup/master-key";
const CONFIG_FILE: &str = "backup-settings.v1.json";

#[derive(Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct BackupConfigFile {
    destination_dir: Option<String>,
    recovery_key_exported: bool,
    // Uygulama-içi zamanlama; eksikse frontend "daily" (mevcut davranış) sayar.
    #[serde(default)]
    schedule_frequency: Option<String>,
    #[serde(default)]
    schedule_hour: Option<u8>,
    #[serde(default)]
    schedule_weekday: Option<u8>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupNativeConfig {
    destination_dir: Option<String>,
    destination_configured: bool,
    destination_available: bool,
    recovery_key_ready: bool,
    recovery_key_exported: bool,
    schedule_frequency: String,
    schedule_hour: Option<u8>,
    schedule_weekday: Option<u8>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupPublishResult {
    local_path: String,
    offsite_path: Option<String>,
    offsite_status: String,
    size_bytes: u64,
    verified: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupRestoreCandidate {
    encrypted_path: String,
    snapshot_path: String,
}

fn program_data_root() -> PathBuf {
    if cfg!(debug_assertions) {
        if let Ok(value) = env::var("SEROGULD_PROGRAM_DATA") {
            if !value.trim().is_empty() {
                return PathBuf::from(value.trim());
            }
        }
    }
    env::var_os("PROGRAMDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\ProgramData"))
        .join("SeroGuldCRM")
}

fn config_path() -> PathBuf {
    program_data_root().join("config").join(CONFIG_FILE)
}

fn load_config() -> BackupConfigFile {
    fs::read(config_path())
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn save_config(config: &BackupConfigFile) -> Result<(), String> {
    let path = config_path();
    let parent = path
        .parent()
        .ok_or_else(|| "Yedek ayar dizini bulunamadı".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Yedek ayar dizini oluşturulamadı: {error}"))?;
    let partial = path.with_extension("json.partial");
    fs::write(
        &partial,
        serde_json::to_vec_pretty(config).map_err(|error| error.to_string())?,
    )
    .map_err(|error| format!("Yedek ayarı yazılamadı: {error}"))?;
    File::open(&partial)
        .and_then(|file| file.sync_all())
        .map_err(|error| format!("Yedek ayarı diske yazılamadı: {error}"))?;
    fs::rename(&partial, &path).map_err(|error| format!("Yedek ayarı yayınlanamadı: {error}"))
}

fn key_entry() -> Result<Entry, String> {
    #[cfg(target_os = "windows")]
    {
        use std::collections::HashMap;
        if let Err(error) = keyring::v1::Entry::store_status() {
            return Err(format!("Windows Credential Manager kullanılamadı: {error}"));
        }
        let modifiers = HashMap::from([("target", KEY_TARGET), ("persistence", "Local")]);
        return Entry::new_with_modifiers(KEY_SERVICE, KEY_ACCOUNT, &modifiers)
            .map_err(|error| format!("Windows Credential Manager kullanılamadı: {error}"));
    }
    #[cfg(not(target_os = "windows"))]
    {
        Entry::new(KEY_SERVICE, KEY_ACCOUNT)
            .map_err(|error| format!("OS credential kasası kullanılamadı: {error}"))
    }
}

fn decode_recovery_key(mut encoded: String) -> Result<[u8; 32], String> {
    let decoded_result = BASE64.decode(encoded.trim().as_bytes());
    encoded.zeroize();
    let mut decoded = decoded_result.map_err(|_| "Kurtarma anahtarı geçersiz".to_string())?;
    if decoded.len() != 32 {
        decoded.zeroize();
        return Err("Kurtarma anahtarı uzunluğu geçersiz".to_string());
    }
    let mut key = [0u8; 32];
    key.copy_from_slice(&decoded);
    decoded.zeroize();
    Ok(key)
}

fn load_or_create_key() -> Result<[u8; 32], String> {
    let entry = key_entry()?;
    let encoded = match entry.get_password() {
        Ok(value) => value,
        Err(KeyringError::NoEntry) => {
            let mut key = [0u8; 32];
            rand::thread_rng().fill_bytes(&mut key);
            let encoded = BASE64.encode(key);
            entry.set_password(&encoded).map_err(|error| {
                format!("Yedek anahtarı Credential Manager'a yazılamadı: {error}")
            })?;
            key.zeroize();
            encoded
        }
        Err(error) => {
            return Err(format!(
                "Yedek anahtarı Credential Manager'dan okunamadı: {error}"
            ))
        }
    };
    decode_recovery_key(encoded)
}

fn key_exists() -> bool {
    key_entry()
        .and_then(|entry| match entry.get_password() {
            Ok(value) => decode_recovery_key(value).map(|mut key| key.zeroize()),
            Err(KeyringError::NoEntry) => Err("missing".to_string()),
            Err(error) => Err(error.to_string()),
        })
        .is_ok()
}

fn record_nonce(prefix: [u8; 8], counter: u32) -> [u8; 12] {
    let mut nonce = [0u8; 12];
    nonce[..8].copy_from_slice(&prefix);
    nonce[8..].copy_from_slice(&counter.to_be_bytes());
    nonce
}

fn record_aad(counter: u32) -> Vec<u8> {
    [MAGIC.as_slice(), counter.to_be_bytes().as_slice()].concat()
}

fn encrypt_file(source: &Path, destination: &Path, key: &[u8; 32]) -> Result<(), String> {
    let mut input = File::open(source).map_err(|error| format!("Snapshot açılamadı: {error}"))?;
    let mut output = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(destination)
        .map_err(|error| format!("Şifreli yedek oluşturulamadı: {error}"))?;
    let cipher =
        Aes256Gcm::new_from_slice(key).map_err(|_| "Yedek anahtarı geçersiz".to_string())?;
    let mut prefix = [0u8; 8];
    rand::thread_rng().fill_bytes(&mut prefix);
    output
        .write_all(MAGIC)
        .and_then(|_| output.write_all(&prefix))
        .map_err(|error| error.to_string())?;

    let mut buffer = vec![0u8; CHUNK_SIZE];
    let mut counter = 0u32;
    loop {
        let read = input
            .read(&mut buffer)
            .map_err(|error| format!("Snapshot okunamadı: {error}"))?;
        if read == 0 {
            break;
        }
        let nonce = record_nonce(prefix, counter);
        let aad = record_aad(counter);
        let encrypted = cipher
            .encrypt(
                Nonce::from_slice(&nonce),
                Payload {
                    msg: &buffer[..read],
                    aad: &aad,
                },
            )
            .map_err(|_| "Yedek şifrelenemedi".to_string())?;
        output
            .write_all(&(read as u32).to_le_bytes())
            .and_then(|_| output.write_all(&encrypted))
            .map_err(|error| format!("Şifreli yedek yazılamadı: {error}"))?;
        counter = counter
            .checked_add(1)
            .ok_or_else(|| "Yedek dosyası çok büyük".to_string())?;
    }
    output
        .write_all(&0u32.to_le_bytes())
        .and_then(|_| output.sync_all())
        .map_err(|error| error.to_string())
}

fn decrypt_file(source: &Path, destination: &Path, key: &[u8; 32]) -> Result<(), String> {
    let mut input =
        File::open(source).map_err(|error| format!("Şifreli yedek açılamadı: {error}"))?;
    let mut magic = [0u8; 8];
    let mut prefix = [0u8; 8];
    input
        .read_exact(&mut magic)
        .and_then(|_| input.read_exact(&mut prefix))
        .map_err(|_| "Yedek başlığı okunamadı".to_string())?;
    if &magic != MAGIC {
        return Err("Yedek formatı desteklenmiyor".to_string());
    }
    let cipher =
        Aes256Gcm::new_from_slice(key).map_err(|_| "Yedek anahtarı geçersiz".to_string())?;
    let partial = destination.with_extension("zip.partial");
    let _ = fs::remove_file(&partial);
    let mut output = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&partial)
        .map_err(|error| error.to_string())?;
    let result = (|| -> Result<(), String> {
        let mut counter = 0u32;
        loop {
            let mut length_bytes = [0u8; 4];
            input
                .read_exact(&mut length_bytes)
                .map_err(|_| "Yedek kaydı eksik".to_string())?;
            let plaintext_length = u32::from_le_bytes(length_bytes) as usize;
            if plaintext_length == 0 {
                break;
            }
            if plaintext_length > CHUNK_SIZE {
                return Err("Yedek parça boyutu geçersiz".to_string());
            }
            let mut encrypted = vec![0u8; plaintext_length + 16];
            input
                .read_exact(&mut encrypted)
                .map_err(|_| "Yedek parçası eksik".to_string())?;
            let nonce = record_nonce(prefix, counter);
            let aad = record_aad(counter);
            let plaintext = cipher
                .decrypt(
                    Nonce::from_slice(&nonce),
                    Payload {
                        msg: &encrypted,
                        aad: &aad,
                    },
                )
                .map_err(|_| "Yedek anahtarı yanlış veya dosya bozuk".to_string())?;
            if plaintext.len() != plaintext_length {
                return Err("Yedek parça doğrulaması başarısız".to_string());
            }
            output
                .write_all(&plaintext)
                .map_err(|error| error.to_string())?;
            counter = counter
                .checked_add(1)
                .ok_or_else(|| "Yedek dosyası çok büyük".to_string())?;
        }
        output.sync_all().map_err(|error| error.to_string())?;
        fs::rename(&partial, destination).map_err(|error| error.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(partial);
    }
    result
}

fn files_equal(left: &Path, right: &Path) -> Result<bool, String> {
    let mut left = File::open(left).map_err(|error| error.to_string())?;
    let mut right = File::open(right).map_err(|error| error.to_string())?;
    let mut left_buffer = vec![0u8; CHUNK_SIZE];
    let mut right_buffer = vec![0u8; CHUNK_SIZE];
    loop {
        let left_read = left
            .read(&mut left_buffer)
            .map_err(|error| error.to_string())?;
        let right_read = right
            .read(&mut right_buffer)
            .map_err(|error| error.to_string())?;
        if left_read != right_read || left_buffer[..left_read] != right_buffer[..right_read] {
            return Ok(false);
        }
        if left_read == 0 {
            return Ok(true);
        }
    }
}

fn verify_encrypted(encrypted: &Path, source: &Path, key: &[u8; 32]) -> Result<(), String> {
    let temporary = encrypted.with_extension("verify.partial");
    let _ = fs::remove_file(&temporary);
    decrypt_file(encrypted, &temporary, key)?;
    let result = match files_equal(source, &temporary)? {
        true => Ok(()),
        false => Err("Şifreli yedek doğrulaması başarısız".to_string()),
    };
    let _ = fs::remove_file(temporary);
    result
}

fn publish_copy(source: &Path, destination: &Path) -> Result<(), String> {
    let partial = destination.with_extension("sgbackup.partial");
    let _ = fs::remove_file(&partial);
    fs::copy(source, &partial)
        .map_err(|error| format!("OneDrive yedeği kopyalanamadı: {error}"))?;
    File::open(&partial)
        .and_then(|file| file.sync_all())
        .map_err(|error| error.to_string())?;
    fs::rename(&partial, destination)
        .map_err(|error| format!("OneDrive yedeği yayınlanamadı: {error}"))
}

fn sync_pending_offsite(local_directory: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination)
        .map_err(|error| format!("Dış yedek klasörü kullanılamadı: {error}"))?;
    let local = local_directory
        .canonicalize()
        .map_err(|error| format!("Yerel yedek klasörü açılamadı: {error}"))?;
    let offsite = destination
        .canonicalize()
        .map_err(|error| format!("Dış yedek klasörü açılamadı: {error}"))?;
    if local == offsite || offsite.starts_with(program_data_root()) {
        return Err("Dış yedek klasörü ProgramData yedek alanının dışında olmalıdır".to_string());
    }

    let mut pending = fs::read_dir(&local)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|value| value.to_str()) == Some("sgbackup"))
        .collect::<Vec<_>>();
    pending.sort();
    for source in pending {
        let Some(name) = source.file_name() else {
            continue;
        };
        let target = offsite.join(name);
        if target.is_file() {
            continue;
        }
        publish_copy(&source, &target)?;
    }
    Ok(())
}

fn prune_tiered(
    directory: &Path,
    quick_limit: usize,
    daily_days: u64,
    weekly_buckets: u64,
    monthly_buckets: u64,
) {
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    let mut files: Vec<PathBuf> = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|value| value.to_str()) == Some("sgbackup"))
        .collect();
    files.sort_by_key(|path| {
        std::cmp::Reverse(
            fs::metadata(path)
                .and_then(|meta| meta.modified())
                .unwrap_or(UNIX_EPOCH),
        )
    });
    let now = SystemTime::now();
    let mut days = HashSet::new();
    let mut weeks = HashSet::new();
    let mut months = HashSet::new();
    for (index, path) in files.into_iter().enumerate() {
        let modified = fs::metadata(&path)
            .and_then(|meta| meta.modified())
            .unwrap_or(UNIX_EPOCH);
        let age = now
            .duration_since(modified)
            .map(|value| value.as_secs())
            .unwrap_or(0);
        let day = age / 86_400;
        let week = age / (7 * 86_400);
        let month = age / (30 * 86_400);
        let keep = index < quick_limit
            || (day < daily_days && days.insert(day))
            || (week < weekly_buckets && weeks.insert(week))
            || (month < monthly_buckets && months.insert(month));
        if !keep {
            let _ = fs::remove_file(path);
        }
    }
}

#[tauri::command]
pub fn get_backup_native_config() -> BackupNativeConfig {
    let config = load_config();
    let available = config
        .destination_dir
        .as_ref()
        .is_some_and(|path| Path::new(path).is_dir());
    let schedule_frequency = normalize_schedule_frequency(config.schedule_frequency.as_deref());
    BackupNativeConfig {
        destination_configured: config.destination_dir.is_some(),
        destination_dir: config.destination_dir,
        destination_available: available,
        recovery_key_ready: key_exists(),
        recovery_key_exported: config.recovery_key_exported,
        schedule_frequency,
        schedule_hour: config.schedule_hour.filter(|hour| *hour <= 23),
        schedule_weekday: config.schedule_weekday.filter(|day| *day <= 6),
    }
}

fn normalize_schedule_frequency(value: Option<&str>) -> String {
    match value.map(str::trim) {
        Some("off") => "off".to_string(),
        Some("weekly") => "weekly".to_string(),
        // Eksik/bilinmeyen değer mevcut günlük davranışı korur.
        _ => "daily".to_string(),
    }
}

#[tauri::command]
pub fn set_backup_schedule(
    frequency: String,
    hour: Option<u8>,
    weekday: Option<u8>,
) -> Result<BackupNativeConfig, String> {
    let normalized = match frequency.trim() {
        "off" | "daily" | "weekly" => frequency.trim().to_string(),
        _ => return Err("Geçersiz yedek sıklığı".to_string()),
    };
    if let Some(value) = hour {
        if value > 23 {
            return Err("Tercih edilen saat 0–23 aralığında olmalı".to_string());
        }
    }
    if let Some(value) = weekday {
        if value > 6 {
            return Err("Gün 0 (Pazar) – 6 (Cumartesi) aralığında olmalı".to_string());
        }
    }
    let mut config = load_config();
    config.schedule_frequency = Some(normalized.clone());
    config.schedule_hour = hour;
    config.schedule_weekday = if normalized == "weekly" { weekday } else { None };
    save_config(&config)?;
    Ok(get_backup_native_config())
}

#[tauri::command]
pub async fn choose_backup_destination() -> Result<BackupNativeConfig, String> {
    let selected = rfd::FileDialog::new()
        .set_title("Sero Guld şifreli yedek klasörünü seçin")
        .pick_folder()
        .ok_or_else(|| "Yedek klasörü seçilmedi".to_string())?;
    fs::create_dir_all(&selected)
        .map_err(|error| format!("Yedek klasörü kullanılamadı: {error}"))?;
    let selected = selected
        .canonicalize()
        .map_err(|error| format!("Yedek klasörü doğrulanamadı: {error}"))?;
    if selected.starts_with(program_data_root()) {
        return Err("OneDrive veya ProgramData dışındaki ayrı bir yedek klasörü seçin".to_string());
    }
    let mut config = load_config();
    config.destination_dir = Some(selected.display().to_string());
    save_config(&config)?;
    Ok(get_backup_native_config())
}

#[tauri::command]
pub fn open_backup_destination() -> Result<String, String> {
    let config = load_config();
    let path = config
        .destination_dir
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            program_data_root()
                .join("data")
                .join("backups")
                .join("daily")
        });
    fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    #[cfg(target_os = "windows")]
    std::process::Command::new("explorer.exe")
        .arg(&path)
        .spawn()
        .map_err(|error| error.to_string())?;
    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open")
        .arg(&path)
        .spawn()
        .map_err(|error| error.to_string())?;
    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg(&path)
        .spawn()
        .map_err(|error| error.to_string())?;
    Ok(path.display().to_string())
}

#[tauri::command]
pub fn export_backup_recovery_key() -> Result<String, String> {
    let mut key = load_or_create_key()?;
    let encoded = BASE64.encode(key);
    key.zeroize();
    let mut config = load_config();
    config.recovery_key_exported = true;
    save_config(&config)?;
    Ok(encoded)
}

#[tauri::command]
pub fn import_backup_recovery_key(recovery_key: String) -> Result<(), String> {
    let mut key = decode_recovery_key(recovery_key)?;
    let encoded = BASE64.encode(key);
    key.zeroize();
    key_entry()?
        .set_password(&encoded)
        .map_err(|error| format!("Kurtarma anahtarı kaydedilemedi: {error}"))
}

#[tauri::command]
pub fn encrypt_backup_snapshot(snapshot_path: String) -> Result<BackupPublishResult, String> {
    let root = program_data_root();
    let staging = root.join("data").join("backups").join("staging");
    let source = PathBuf::from(snapshot_path)
        .canonicalize()
        .map_err(|_| "Snapshot bulunamadı".to_string())?;
    let staging = staging
        .canonicalize()
        .map_err(|_| "Snapshot staging alanı bulunamadı".to_string())?;
    if source.parent() != Some(staging.as_path())
        || source.extension().and_then(|value| value.to_str()) != Some("zip")
    {
        return Err("Snapshot yedek staging alanının dışında".to_string());
    }
    let daily = root.join("data").join("backups").join("daily");
    fs::create_dir_all(&daily).map_err(|error| error.to_string())?;
    let stem = source
        .file_stem()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "Snapshot adı geçersiz".to_string())?;
    let final_name = format!("{stem}.sgbackup");
    let local = daily.join(&final_name);
    let partial = local.with_extension("sgbackup.partial");
    let _ = fs::remove_file(&partial);
    let mut key = load_or_create_key()?;
    let result = (|| -> Result<BackupPublishResult, String> {
        encrypt_file(&source, &partial, &key)?;
        verify_encrypted(&partial, &source, &key)?;
        fs::rename(&partial, &local)
            .map_err(|error| format!("Yerel yedek yayınlanamadı: {error}"))?;
        prune_tiered(&daily, 24, 30, 12, 0);

        let config = load_config();
        let (offsite_path, offsite_status) =
            if let Some(destination) = config.destination_dir.map(PathBuf::from) {
                let target = destination.join(&final_name);
                match sync_pending_offsite(&daily, &destination) {
                    Ok(()) => {
                        prune_tiered(&destination, 0, 30, 12, 12);
                        (Some(target.display().to_string()), "synced".to_string())
                    }
                    Err(_) => (None, "pending".to_string()),
                }
            } else {
                (None, "not-configured".to_string())
            };
        Ok(BackupPublishResult {
            local_path: local.display().to_string(),
            offsite_path,
            offsite_status,
            size_bytes: fs::metadata(&local)
                .map_err(|error| error.to_string())?
                .len(),
            verified: true,
        })
    })();
    key.zeroize();
    let _ = fs::remove_file(&partial);
    if result.is_ok() {
        let _ = fs::remove_file(source);
    }
    result
}

#[tauri::command]
pub async fn pick_backup_for_restore() -> Result<String, String> {
    rfd::FileDialog::new()
        .add_filter("Sero Guld şifreli yedeği", &["sgbackup"])
        .pick_file()
        .map(|path| path.display().to_string())
        .ok_or_else(|| "Yedek dosyası seçilmedi".to_string())
}

#[tauri::command]
pub fn decrypt_backup_for_restore(
    encrypted_path: String,
) -> Result<BackupRestoreCandidate, String> {
    let encrypted = PathBuf::from(&encrypted_path)
        .canonicalize()
        .map_err(|_| "Yedek dosyası bulunamadı".to_string())?;
    if encrypted.extension().and_then(|value| value.to_str()) != Some("sgbackup") {
        return Err("Yalnız .sgbackup dosyaları açılabilir".to_string());
    }
    let staging = program_data_root()
        .join("data")
        .join("backups")
        .join("staging");
    fs::create_dir_all(&staging).map_err(|error| error.to_string())?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or(0);
    let snapshot = staging.join(format!("seroguld-snapshot-restore-{timestamp}.zip"));
    let mut key = load_or_create_key()?;
    let result = decrypt_file(&encrypted, &snapshot, &key);
    key.zeroize();
    result?;
    Ok(BackupRestoreCandidate {
        encrypted_path,
        snapshot_path: snapshot.display().to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encrypted_backup_roundtrip_and_wrong_key_fails() {
        let temp = std::env::temp_dir().join(format!(
            "seroguld-backup-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&temp).unwrap();
        let source = temp.join("snapshot.zip");
        let encrypted = temp.join("snapshot.sgbackup.partial");
        let restored = temp.join("restored.zip");
        fs::write(&source, vec![42u8; CHUNK_SIZE + 79]).unwrap();
        let key = [7u8; 32];
        encrypt_file(&source, &encrypted, &key).unwrap();
        decrypt_file(&encrypted, &restored, &key).unwrap();
        assert_eq!(fs::read(&source).unwrap(), fs::read(&restored).unwrap());
        assert!(decrypt_file(&encrypted, &temp.join("wrong.zip"), &[8u8; 32]).is_err());
        let _ = fs::remove_dir_all(temp);
    }

    #[test]
    fn pending_offsite_backups_are_retried_without_overwriting_existing_files() {
        let temp = std::env::temp_dir().join(format!(
            "seroguld-offsite-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let local = temp.join("local");
        let offsite = temp.join("offsite");
        fs::create_dir_all(&local).unwrap();
        fs::create_dir_all(&offsite).unwrap();
        fs::write(local.join("first.sgbackup"), b"first").unwrap();
        fs::write(local.join("second.sgbackup"), b"second").unwrap();
        fs::write(offsite.join("first.sgbackup"), b"already-synced").unwrap();

        sync_pending_offsite(&local, &offsite).unwrap();

        assert_eq!(
            fs::read(offsite.join("first.sgbackup")).unwrap(),
            b"already-synced"
        );
        assert_eq!(
            fs::read(offsite.join("second.sgbackup")).unwrap(),
            b"second"
        );
        let _ = fs::remove_dir_all(temp);
    }
}
