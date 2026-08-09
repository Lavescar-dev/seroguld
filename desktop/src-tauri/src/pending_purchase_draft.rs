use aes_gcm::{aead::Aead, Aes256Gcm, KeyInit, Nonce};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use keyring::{Entry, Error as KeyringError};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};
use zeroize::Zeroize;

#[cfg(unix)]
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};

const KEY_SERVICE: &str = "seroguld-crm.pending-purchase-drafts";
const KEY_ACCOUNT: &str = "device-key-v1";
const SCHEMA_VERSION: u32 = 1;
const TTL_SECONDS: u64 = 7 * 24 * 60 * 60;
const MAX_DRAFT_JSON_BYTES: usize = 512 * 1024;
const MAX_ENVELOPE_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingPurchaseDraftInput {
    pub owner_key: String,
    pub session_id: String,
    pub base_revision: u64,
    pub generation: u64,
    pub baseline: Value,
    pub local: Value,
    pub created_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PendingPurchaseDraftOut {
    pub owner_key: String,
    pub session_id: String,
    pub base_revision: u64,
    pub generation: u64,
    pub baseline: Value,
    pub local: Value,
    pub created_at: String,
    pub updated_at: String,
    pub expires_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PendingPurchaseDraftEnvelope {
    schema_version: u32,
    owner_key: String,
    session_id: String,
    base_revision: u64,
    generation: u64,
    created_at: String,
    updated_at: String,
    expires_at: String,
    nonce: String,
    ciphertext: String,
}

fn now_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn now_iso() -> String {
    // An integer timestamp is sufficient for expiry and avoids adding a date
    // dependency to the desktop shell.  The frontend treats it as an opaque
    // ISO-like diagnostic value and never displays PII from this file.
    format!("unix:{}", now_seconds())
}

fn parse_unix_timestamp(value: &str) -> Option<u64> {
    value.strip_prefix("unix:")?.parse().ok()
}

fn validate_atom(value: &str, label: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 160
        || !value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "-_.".contains(character))
    {
        return Err(format!("{label} geçersiz"));
    }
    Ok(())
}

fn validate_json_value(value: &Value, label: &str) -> Result<(), String> {
    let encoded = serde_json::to_vec(value).map_err(|error| error.to_string())?;
    if encoded.len() > MAX_DRAFT_JSON_BYTES {
        return Err(format!("{label} çok büyük"));
    }
    Ok(())
}

fn drafts_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?
        .join("pending-purchase-drafts"))
}

fn owner_dir(app: &AppHandle, owner_key: &str) -> Result<PathBuf, String> {
    validate_atom(owner_key, "owner_key")?;
    Ok(drafts_root(app)?.join(owner_key))
}

fn draft_path(app: &AppHandle, owner_key: &str, session_id: &str) -> Result<PathBuf, String> {
    validate_atom(session_id, "session_id")?;
    Ok(owner_dir(app, owner_key)?.join(format!("{session_id}.json.enc")))
}

fn load_device_key() -> Result<[u8; 32], String> {
    let entry = Entry::new(KEY_SERVICE, KEY_ACCOUNT)
        .map_err(|error| format!("OS credential kasası açılamadı: {error}"))?;
    let mut raw = match entry.get_password() {
        Ok(value) => value,
        Err(KeyringError::NoEntry) => {
            let mut bytes = [0u8; 32];
            rand::thread_rng().fill_bytes(&mut bytes);
            let encoded = BASE64.encode(bytes);
            entry
                .set_password(&encoded)
                .map_err(|error| format!("OS credential anahtarı saklanamadı: {error}"))?;
            bytes.zeroize();
            encoded
        }
        Err(error) => return Err(format!("OS credential anahtarı okunamadı: {error}")),
    };
    let decoded_result = BASE64.decode(raw.as_bytes());
    raw.zeroize();
    let mut decoded =
        decoded_result.map_err(|error| format!("OS credential anahtarı bozuk: {error}"))?;
    if decoded.len() != 32 {
        decoded.zeroize();
        return Err("OS credential anahtar uzunluğu geçersiz".to_string());
    }
    let mut key = [0u8; 32];
    key.copy_from_slice(&decoded);
    decoded.zeroize();
    Ok(key)
}

fn encrypt_payload(
    input: &PendingPurchaseDraftInput,
    created_at: String,
    updated_at: String,
    expires_at: String,
) -> Result<PendingPurchaseDraftEnvelope, String> {
    validate_json_value(&input.baseline, "baseline")?;
    validate_json_value(&input.local, "local")?;
    let mut key = load_device_key()?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|error| error.to_string())?;
    key.zeroize();
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let mut plaintext = serde_json::to_vec(&serde_json::json!({
        "baseline": input.baseline.clone(),
        "local": input.local.clone(),
    }))
    .map_err(|error| error.to_string())?;
    if plaintext.len() > MAX_DRAFT_JSON_BYTES * 2 {
        plaintext.zeroize();
        return Err("taslak verisi çok büyük".to_string());
    }
    let aad = format!(
        "seroguld-purchase-draft-v{SCHEMA_VERSION}:{}:{}",
        input.owner_key, input.session_id
    );
    let ciphertext = cipher
        .encrypt(
            Nonce::from_slice(&nonce_bytes),
            aes_gcm::aead::Payload {
                msg: &plaintext,
                aad: aad.as_bytes(),
            },
        )
        .map_err(|error| format!("taslak şifrelenemedi: {error}"))?;
    plaintext.zeroize();
    Ok(PendingPurchaseDraftEnvelope {
        schema_version: SCHEMA_VERSION,
        owner_key: input.owner_key.clone(),
        session_id: input.session_id.clone(),
        base_revision: input.base_revision,
        generation: input.generation,
        created_at,
        updated_at,
        expires_at,
        nonce: BASE64.encode(nonce_bytes),
        ciphertext: BASE64.encode(ciphertext),
    })
}

fn decrypt_payload(
    envelope: PendingPurchaseDraftEnvelope,
) -> Result<PendingPurchaseDraftOut, String> {
    if envelope.schema_version != SCHEMA_VERSION {
        return Err("taslak şema sürümü desteklenmiyor".to_string());
    }
    let mut key = load_device_key()?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|error| error.to_string())?;
    key.zeroize();
    let mut nonce = BASE64
        .decode(envelope.nonce.as_bytes())
        .map_err(|error| format!("taslak nonce bozuk: {error}"))?;
    let mut ciphertext = BASE64
        .decode(envelope.ciphertext.as_bytes())
        .map_err(|error| format!("taslak ciphertext bozuk: {error}"))?;
    if nonce.len() != 12 {
        ciphertext.zeroize();
        return Err("taslak nonce uzunluğu geçersiz".to_string());
    }
    if ciphertext.len() > MAX_ENVELOPE_BYTES || ciphertext.len() < 16 {
        ciphertext.zeroize();
        return Err("taslak ciphertext boyutu geçersiz".to_string());
    }
    let aad = format!(
        "seroguld-purchase-draft-v{}:{}:{}",
        envelope.schema_version, envelope.owner_key, envelope.session_id
    );
    let decrypt_result = cipher
        .decrypt(
            Nonce::from_slice(&nonce),
            aes_gcm::aead::Payload {
                msg: ciphertext.as_slice(),
                aad: aad.as_bytes(),
            },
        )
        .map_err(|_| "taslak bütünlük doğrulaması başarısız".to_string());
    let mut plaintext = match decrypt_result {
        Ok(value) => value,
        Err(error) => {
            nonce.zeroize();
            ciphertext.zeroize();
            return Err(error);
        }
    };
    nonce.zeroize();
    ciphertext.zeroize();
    let parsed_payload =
        serde_json::from_slice::<Value>(&plaintext).map_err(|error| error.to_string());
    plaintext.zeroize();
    let payload = parsed_payload?;
    let baseline = payload.get("baseline").cloned().unwrap_or(Value::Null);
    let local = payload.get("local").cloned().unwrap_or(Value::Null);
    validate_json_value(&baseline, "baseline")?;
    validate_json_value(&local, "local")?;
    Ok(PendingPurchaseDraftOut {
        owner_key: envelope.owner_key,
        session_id: envelope.session_id,
        base_revision: envelope.base_revision,
        generation: envelope.generation,
        baseline,
        local,
        created_at: envelope.created_at,
        updated_at: envelope.updated_at,
        expires_at: envelope.expires_at,
    })
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if bytes.len() > MAX_ENVELOPE_BYTES {
        return Err("taslak zarfı çok büyük".to_string());
    }
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let temp = path.with_file_name(format!(
        ".{}.{}.tmp",
        path.file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("draft"),
        format!("{}-{nonce}", std::process::id()),
    ));
    let mut options = OpenOptions::new();
    options.create(true).truncate(true).write(true);
    #[cfg(unix)]
    options.mode(0o600);
    let mut file = options.open(&temp).map_err(|error| error.to_string())?;
    file.write_all(bytes).map_err(|error| error.to_string())?;
    file.sync_all().map_err(|error| error.to_string())?;
    drop(file);
    if let Err(error) = fs::rename(&temp, path) {
        // Windows does not replace an existing file with rename.  Keep the
        // normal path atomic; only use the compatibility fallback when the
        // platform rejects the replacement operation.
        if path.exists() {
            fs::remove_file(path).map_err(|remove_error| remove_error.to_string())?;
            fs::rename(&temp, path).map_err(|rename_error| rename_error.to_string())?;
        } else {
            let _ = fs::remove_file(&temp);
            return Err(error.to_string());
        }
    }
    #[cfg(unix)]
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn persist_pending_purchase_draft(
    app: AppHandle,
    input: PendingPurchaseDraftInput,
) -> Result<(), String> {
    validate_atom(&input.owner_key, "owner_key")?;
    validate_atom(&input.session_id, "session_id")?;
    let updated_at = now_iso();
    let created_at = input
        .created_at
        .clone()
        .unwrap_or_else(|| updated_at.clone());
    let expires_at = format!("unix:{}", now_seconds() + TTL_SECONDS);
    let envelope = encrypt_payload(&input, created_at, updated_at, expires_at)?;
    let directory = owner_dir(&app, &input.owner_key)?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))
        .map_err(|error| error.to_string())?;
    let path = draft_path(&app, &input.owner_key, &input.session_id)?;
    let bytes = serde_json::to_vec(&envelope).map_err(|error| error.to_string())?;
    atomic_write(&path, &bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn atom_validation_rejects_paths_and_empty_values() {
        assert!(validate_atom("owner-1", "owner").is_ok());
        assert!(validate_atom("", "owner").is_err());
        assert!(validate_atom("../owner", "owner").is_err());
    }

    #[test]
    fn atomic_write_replaces_existing_file_without_leaving_temp_file() {
        let root = std::env::temp_dir().join(format!("seroguld-draft-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("test directory");
        let path = root.join("draft.json.enc");
        atomic_write(&path, b"first").expect("first write");
        atomic_write(&path, b"second").expect("replacement write");
        assert_eq!(fs::read(&path).expect("draft contents"), b"second");
        let temporary_files = fs::read_dir(&root)
            .expect("test directory listing")
            .filter_map(Result::ok)
            .filter(|entry| {
                entry.path().extension().and_then(|value| value.to_str()) == Some("tmp")
            })
            .count();
        assert_eq!(temporary_files, 0);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn json_size_limit_rejects_large_local_snapshot() {
        let value = Value::String("x".repeat(MAX_DRAFT_JSON_BYTES));
        assert!(validate_json_value(&value, "local").is_err());
    }
}

#[tauri::command]
pub async fn list_pending_purchase_drafts(
    app: AppHandle,
    owner_key: String,
) -> Result<Vec<PendingPurchaseDraftOut>, String> {
    let directory = owner_dir(&app, &owner_key)?;
    if !directory.exists() {
        return Ok(Vec::new());
    }
    let mut output = Vec::new();
    for entry in fs::read_dir(&directory).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("enc") {
            continue;
        }
        let bytes = match fs::read(&path) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let envelope: PendingPurchaseDraftEnvelope = match serde_json::from_slice(&bytes) {
            Ok(value) => value,
            Err(_) => continue,
        };
        if parse_unix_timestamp(&envelope.expires_at)
            .is_some_and(|expires| expires <= now_seconds())
        {
            let _ = fs::remove_file(&path);
            continue;
        }
        if envelope.owner_key != owner_key {
            continue;
        }
        if let Ok(value) = decrypt_payload(envelope) {
            output.push(value);
        }
    }
    output.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    Ok(output)
}

#[tauri::command]
pub async fn delete_pending_purchase_draft(
    app: AppHandle,
    owner_key: String,
    session_id: String,
) -> Result<(), String> {
    let path = draft_path(&app, &owner_key, &session_id)?;
    if path.exists() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    Ok(())
}
