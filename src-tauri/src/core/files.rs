use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

pub const AUDIO_EXTENSIONS: &[&str] = &["mp3", "flac", "wav", "ogg", "m4a", "wma"];

pub fn is_audio_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| AUDIO_EXTENSIONS.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

pub fn list_audio_files(dir: &str) -> Result<Vec<String>, String> {
    Ok(WalkDir::new(dir)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file() && is_audio_file(e.path()))
        .map(|e| e.path().to_string_lossy().to_string())
        .collect())
}

pub fn config_path(music_folder: &str) -> PathBuf {
    Path::new(music_folder).join("config")
}

pub fn read_file_base64(path: &str) -> Result<String, String> {
    use base64::Engine;
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
}

pub fn write_file(path: &str, content: &str) -> Result<(), String> {
    if let Some(parent) = Path::new(path).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(path, content).map_err(|e| e.to_string())
}

pub fn read_file(path: &str) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| e.to_string())
}

pub fn copy_file(src: &str, dest: &str) -> Result<(), String> {
    if let Some(parent) = Path::new(dest).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::copy(src, dest).map_err(|e| format!("copy {} → {}: {}", src, dest, e))?;
    Ok(())
}

pub fn mkdir(path: &str) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_audio_file() {
        assert!(is_audio_file(Path::new("song.mp3")));
        assert!(is_audio_file(Path::new("song.flac")));
        assert!(is_audio_file(Path::new("song.wav")));
        assert!(is_audio_file(Path::new("song.MP3")));
        assert!(!is_audio_file(Path::new("song.txt")));
        assert!(!is_audio_file(Path::new("song")));
        assert!(!is_audio_file(Path::new("song.jpg")));
    }
}

pub fn read_config(music_folder: &str, key: &str) -> Result<Option<serde_json::Value>, String> {
    let path = config_path(music_folder).join(format!("{}.json", key));
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let val: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(Some(val))
}

pub fn write_config(music_folder: &str, key: &str, data: &serde_json::Value) -> Result<(), String> {
    let dir = config_path(music_folder);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{}.json", key));
    let json = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

// ── Music folder persistence ────────────────────────────────────────

fn persisted_music_folder_path() -> Option<PathBuf> {
    dirs::config_dir().map(|d| d.join("musicli").join("music_folder"))
}

fn read_persisted_music_folder() -> Option<String> {
    let path = persisted_music_folder_path()?;
    let content = fs::read_to_string(&path).ok()?;
    let mf = content.trim().to_string();
    if !mf.is_empty() && Path::new(&mf).is_dir() {
        Some(mf)
    } else {
        None
    }
}

pub fn persist_music_folder(path: &str) {
    if let Some(p) = persisted_music_folder_path() {
        if let Some(parent) = p.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::write(&p, path);
    }
}

pub fn resolve_music_folder(cli_arg: Option<&str>) -> String {
    // 1. CLI arg always wins, and persists for next time
    if let Some(mf) = cli_arg {
        if !mf.is_empty() && Path::new(mf).is_dir() {
            persist_music_folder(mf);
            return mf.to_string();
        }
    }
    // 2. Persisted config file
    if let Some(mf) = read_persisted_music_folder() {
        return mf;
    }
    // 3. System audio directory
    dirs::audio_dir()
        .or_else(|| dirs::home_dir().map(|h| h.join("Music")))
        .filter(|p| p.is_dir())
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default()
}
