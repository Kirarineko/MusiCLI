use std::collections::HashMap;
use std::fs;
use std::path::Path;
use walkdir::WalkDir;

pub fn find_lrc(audio_path: &str, root_dir: &str) -> Result<Option<String>, String> {
    let audio = Path::new(audio_path);
    let stem = audio.file_stem()
        .unwrap_or_default()
        .to_string_lossy();
    let lrc_name = format!("{}.lrc", stem);

    // 1. Same directory as audio file
    if let Some(parent) = audio.parent() {
        let candidate = parent.join(&lrc_name);
        if candidate.exists() {
            return Ok(Some(candidate.to_string_lossy().to_string()));
        }
        // Also check lrc/ subdirectory
        let lrc_sub = parent.join("lrc").join(&lrc_name);
        if lrc_sub.exists() {
            return Ok(Some(lrc_sub.to_string_lossy().to_string()));
        }
    }

    // 2. Music folder's lrc/ directory
    let global_lrc = Path::new(root_dir).join("lrc").join(&lrc_name);
    if global_lrc.exists() {
        return Ok(Some(global_lrc.to_string_lossy().to_string()));
    }

    // 3. Recursive search in music folder (limited depth)
    for entry in WalkDir::new(root_dir).max_depth(4).into_iter().filter_map(|e| e.ok()) {
        if entry.file_type().is_file()
            && entry.path().extension().map(|e| e == "lrc").unwrap_or(false)
            && entry.path().file_stem().unwrap_or_default() == stem.as_ref()
        {
            return Ok(Some(entry.path().to_string_lossy().to_string()));
        }
    }

    Ok(None)
}

pub fn read_lrc_offsets(lrc_dir: &str) -> Result<HashMap<String, i64>, String> {
    let path = Path::new(lrc_dir).join("offsets.json");
    if !path.exists() {
        return Ok(HashMap::new());
    }
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read offsets.json: {}", e))?;
    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse offsets.json: {}", e))
}

pub fn write_lrc_offset(lrc_dir: &str, track_name: &str, offset_ms: i64) -> Result<(), String> {
    // If the offsets file exists but is corrupt, surface the error instead of
    // silently overwriting it with an empty map (which would erase all offsets).
    let mut offsets = read_lrc_offsets(lrc_dir)?;
    if offset_ms == 0 {
        offsets.remove(track_name);
    } else {
        offsets.insert(track_name.to_string(), offset_ms);
    }
    let path = Path::new(lrc_dir).join("offsets.json");
    fs::create_dir_all(lrc_dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(&offsets).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_read_lrc_offsets_empty() {
        let dir = TempDir::new().unwrap();
        let offsets = read_lrc_offsets(dir.path().to_str().unwrap()).unwrap();
        assert!(offsets.is_empty());
    }

    #[test]
    fn test_write_and_read_lrc_offset() {
        let dir = TempDir::new().unwrap();
        let dir_str = dir.path().to_str().unwrap();

        write_lrc_offset(dir_str, "track1", 1500).unwrap();
        let offsets = read_lrc_offsets(dir_str).unwrap();
        assert_eq!(offsets.get("track1"), Some(&1500));
    }

    #[test]
    fn test_remove_lrc_offset() {
        let dir = TempDir::new().unwrap();
        let dir_str = dir.path().to_str().unwrap();

        write_lrc_offset(dir_str, "track1", 500).unwrap();
        write_lrc_offset(dir_str, "track1", 0).unwrap();
        let offsets = read_lrc_offsets(dir_str).unwrap();
        assert!(!offsets.contains_key("track1"));
    }

    #[test]
    fn test_multiple_offsets() {
        let dir = TempDir::new().unwrap();
        let dir_str = dir.path().to_str().unwrap();

        write_lrc_offset(dir_str, "a", 100).unwrap();
        write_lrc_offset(dir_str, "b", 200).unwrap();
        let offsets = read_lrc_offsets(dir_str).unwrap();
        assert_eq!(offsets.len(), 2);
        assert_eq!(offsets.get("a"), Some(&100));
        assert_eq!(offsets.get("b"), Some(&200));
    }
}
