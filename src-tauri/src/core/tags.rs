use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

/// Sidecar tag storage: {music_folder}/config/tags.json.
/// Keyed by the track's file name (basename) — like lrc offsets — so tags
/// survive file moves within the library and travel with sync packages.
fn tags_path(music_folder: &str) -> std::path::PathBuf {
    Path::new(music_folder).join("config").join("tags.json")
}

/// Track key: basename of the audio file (with extension).
pub fn track_key(path: &str) -> String {
    Path::new(path)
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string()
}

pub fn read_all_tags(music_folder: &str) -> Result<BTreeMap<String, Vec<String>>, String> {
    let path = tags_path(music_folder);
    if !path.exists() {
        return Ok(BTreeMap::new());
    }
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read tags.json: {}", e))?;
    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse tags.json: {}", e))
}

pub fn get_tags(music_folder: &str, track_path: &str) -> Result<Vec<String>, String> {
    let all = read_all_tags(music_folder)?;
    Ok(all.get(&track_key(track_path)).cloned().unwrap_or_default())
}

/// Set the full tag list for a track. An empty list removes the entry.
/// Tags are trimmed and deduplicated (case-insensitive, first wins).
pub fn set_tags(music_folder: &str, track_path: &str, tags: &[String]) -> Result<(), String> {
    // Surface a parse error instead of silently wiping the whole file.
    let mut all = read_all_tags(music_folder)?;
    let key = track_key(track_path);
    let cleaned = normalize_tags(tags);
    if cleaned.is_empty() {
        all.remove(&key);
    } else {
        all.insert(key, cleaned);
    }
    let path = tags_path(music_folder);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(&all).map_err(|e| e.to_string())?;
    // Atomic write: temp file in the same directory, then rename.
    let tmp_path = path.with_extension("json.tmp");
    fs::write(&tmp_path, &json).map_err(|e| e.to_string())?;
    fs::rename(&tmp_path, &path).map_err(|e| {
        let _ = fs::remove_file(&tmp_path);
        format!("Failed to finalize tags.json: {}", e)
    })
}

/// Union of all tags across the library (the "tag library"), deduplicated
/// case-insensitively (first spelling wins) and sorted case-insensitively.
/// Sent to the LLM so it reuses existing tags instead of inventing variants.
pub fn all_tags(music_folder: &str) -> Result<Vec<String>, String> {
    let all = read_all_tags(music_folder)?;
    let mut seen: Vec<String> = Vec::new();
    let mut out: Vec<String> = Vec::new();
    for tags in all.values() {
        for t in tags {
            let lower = t.to_lowercase();
            if !seen.contains(&lower) {
                seen.push(lower);
                out.push(t.clone());
            }
        }
    }
    out.sort_by_key(|t| t.to_lowercase());
    Ok(out)
}

fn normalize_tags(tags: &[String]) -> Vec<String> {
    let mut seen: Vec<String> = Vec::new();
    let mut out: Vec<String> = Vec::new();
    for t in tags {
        let trimmed = t.trim();
        if trimmed.is_empty() {
            continue;
        }
        let lower = trimmed.to_lowercase();
        if !seen.contains(&lower) {
            seen.push(lower);
            out.push(trimmed.to_string());
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_get_tags_empty() {
        let dir = TempDir::new().unwrap();
        let tags = get_tags(dir.path().to_str().unwrap(), "song.mp3").unwrap();
        assert!(tags.is_empty());
    }

    #[test]
    fn test_set_and_get_tags() {
        let dir = TempDir::new().unwrap();
        let mf = dir.path().to_str().unwrap();
        set_tags(mf, "/music/sub/song.mp3", &["rock".into(), "j-pop".into()]).unwrap();
        // Keyed by basename — a different directory still resolves.
        let tags = get_tags(mf, "song.mp3").unwrap();
        assert_eq!(tags, vec!["rock".to_string(), "j-pop".to_string()]);
    }

    #[test]
    fn test_set_tags_dedup_and_trim() {
        let dir = TempDir::new().unwrap();
        let mf = dir.path().to_str().unwrap();
        set_tags(mf, "a.mp3", &[" Rock ".into(), "rock".into(), "".into(), "pop".into()]).unwrap();
        let tags = get_tags(mf, "a.mp3").unwrap();
        assert_eq!(tags, vec!["Rock".to_string(), "pop".to_string()]);
    }

    #[test]
    fn test_empty_tags_removes_entry() {
        let dir = TempDir::new().unwrap();
        let mf = dir.path().to_str().unwrap();
        set_tags(mf, "a.mp3", &["rock".into()]).unwrap();
        set_tags(mf, "a.mp3", &[]).unwrap();
        let all = read_all_tags(mf).unwrap();
        assert!(!all.contains_key("a.mp3"));
    }

    #[test]
    fn test_multiple_tracks() {
        let dir = TempDir::new().unwrap();
        let mf = dir.path().to_str().unwrap();
        set_tags(mf, "a.mp3", &["rock".into()]).unwrap();
        set_tags(mf, "b.flac", &["jazz".into()]).unwrap();
        let all = read_all_tags(mf).unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(all.get("b.flac").unwrap(), &vec!["jazz".to_string()]);
    }

    #[test]
    fn test_all_tags_dedup_and_sorted() {
        let dir = TempDir::new().unwrap();
        let mf = dir.path().to_str().unwrap();
        set_tags(mf, "a.mp3", &["Rock".into(), "upbeat".into()]).unwrap();
        set_tags(mf, "b.flac", &["rock".into(), "Jazz".into()]).unwrap();
        let lib = all_tags(mf).unwrap();
        // Case-insensitive dedup; sorted case-insensitively.
        assert_eq!(lib, vec!["Jazz".to_string(), "Rock".to_string(), "upbeat".to_string()]);
    }
}
