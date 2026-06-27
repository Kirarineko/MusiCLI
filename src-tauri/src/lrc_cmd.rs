use std::fs;
use std::path::Path;
#[cfg(feature = "gui")]
use tauri::command;
use walkdir::WalkDir;

#[cfg(feature = "gui")]
#[command]
pub async fn find_lrc(mp3_path: String, root_dir: String) -> Result<Option<String>, String> {
    let base = Path::new(&mp3_path)
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_lowercase();
    let target = format!("{}.lrc", base);

    for entry in WalkDir::new(&root_dir)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy().to_lowercase();
            if e.file_type().is_dir() && (name.starts_with('.') || name == "node_modules") {
                return false;
            }
            true
        })
        .filter_map(|e| e.ok())
    {
        if entry.file_type().is_file() {
            let name = entry.file_name().to_string_lossy().to_lowercase();
            if name == target {
                return Ok(Some(entry.path().to_string_lossy().to_string()));
            }
        }
    }
    Ok(None)
}

#[cfg(feature = "gui")]
#[command]
pub async fn read_lrc_offsets(lrc_dir: String) -> Result<serde_json::Value, String> {
    let path = Path::new(&lrc_dir).join("offsets.json");
    if !path.exists() {
        return Ok(serde_json::json!({}));
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let val: serde_json::Value =
        serde_json::from_str(&content).unwrap_or(serde_json::json!({}));
    Ok(val)
}

#[cfg(feature = "gui")]
#[command]
pub async fn write_lrc_offset(
    lrc_dir: String,
    track_name: String,
    offset_ms: i64,
) -> Result<(), String> {
    let dir = Path::new(&lrc_dir);
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let path = dir.join("offsets.json");

    let mut data: serde_json::Value = if path.exists() {
        let content = fs::read_to_string(&path).unwrap_or_default();
        serde_json::from_str(&content).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    if let Some(obj) = data.as_object_mut() {
        if offset_ms == 0 {
            obj.remove(&track_name);
        } else {
            obj.insert(track_name, serde_json::json!(offset_ms));
        }
    }

    let json = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

/// Sync version for headless/server mode.
pub fn find_lrc_sync(mp3_path: &str, root_dir: &str) -> Result<Option<String>, String> {
    let base = Path::new(mp3_path)
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_lowercase();
    let target = format!("{}.lrc", base);

    for entry in WalkDir::new(root_dir)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy().to_lowercase();
            if e.file_type().is_dir() && (name.starts_with('.') || name == "node_modules") {
                return false;
            }
            true
        })
        .filter_map(|e| e.ok())
    {
        if entry.file_type().is_file() {
            if entry.file_name().to_string_lossy().to_lowercase() == target {
                return Ok(Some(entry.path().to_string_lossy().to_string()));
            }
        }
    }
    Ok(None)
}
