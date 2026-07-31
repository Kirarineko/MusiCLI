use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;

/// One indexed audio file. `path` is relative to the music folder with
/// forward slashes so results are portable across client platforms.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct IndexEntry {
    pub path: String,
    pub name: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration: Option<f64>,
    pub size: u64,
    pub mtime: u64,
}

/// A search hit: index entry plus its sidecar tags.
#[derive(Debug, Serialize)]
pub struct SearchHit {
    pub path: String,
    pub name: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration: Option<f64>,
    pub size: u64,
    pub tags: Vec<String>,
}

fn index_path(music_folder: &str) -> std::path::PathBuf {
    Path::new(music_folder).join("config").join("search_index.json")
}

fn file_stamp(path: &Path) -> Option<(u64, u64)> {
    let meta = fs::metadata(path).ok()?;
    let mtime = meta
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_secs();
    Some((meta.len(), mtime))
}

fn rel_path(music_folder: &str, path: &Path) -> String {
    path.strip_prefix(music_folder)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
        .trim_start_matches('/')
        .to_string()
}

/// Build (or incrementally refresh) the metadata index. Entries whose
/// size+mtime are unchanged are reused without re-reading tags via lofty.
pub fn build_index(music_folder: &str) -> Result<Vec<IndexEntry>, String> {
    let old: BTreeMap<String, IndexEntry> = fs::read_to_string(index_path(music_folder))
        .ok()
        .and_then(|c| serde_json::from_str::<Vec<IndexEntry>>(&c).ok())
        .map(|v| v.into_iter().map(|e| (e.path.clone(), e)).collect())
        .unwrap_or_default();

    let files = super::files::list_audio_files(music_folder)?;
    let mut entries: Vec<IndexEntry> = Vec::with_capacity(files.len());
    let mut changed = false;
    for f in &files {
        let p = Path::new(f);
        let Some((size, mtime)) = file_stamp(p) else { continue };
        let rel = rel_path(music_folder, p);
        if let Some(e) = old.get(&rel) {
            if e.size == size && e.mtime == mtime {
                entries.push(e.clone());
                continue;
            }
        }
        changed = true;
        let name = p
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        // Metadata read may fail on corrupt files — fall back to the filename.
        let (title, artist, album, duration) = match super::metadata::read_metadata(f) {
            Ok(m) => (m.title, m.artist, m.album, m.duration),
            Err(_) => (
                p.file_stem().unwrap_or_default().to_string_lossy().to_string(),
                "Unknown Artist".to_string(),
                String::new(),
                None,
            ),
        };
        entries.push(IndexEntry { path: rel, name, title, artist, album, duration, size, mtime });
    }
    if changed || entries.len() != old.len() {
        let path = index_path(music_folder);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let json = serde_json::to_string(&entries).map_err(|e| e.to_string())?;
        let tmp = path.with_extension("json.tmp");
        fs::write(&tmp, &json).map_err(|e| e.to_string())?;
        fs::rename(&tmp, &path).map_err(|e| {
            let _ = fs::remove_file(&tmp);
            format!("Failed to finalize search_index.json: {}", e)
        })?;
    }
    Ok(entries)
}

/// Search the library. `q` matches filename/title/artist/album
/// (case-insensitive substring); `tag` filters by sidecar tag (exact,
/// case-insensitive). Both are optional and combinable.
pub fn search(
    music_folder: &str,
    q: Option<&str>,
    tag: Option<&str>,
    limit: usize,
) -> Result<Vec<SearchHit>, String> {
    let entries = build_index(music_folder)?;
    let all_tags = super::tags::read_all_tags(music_folder).unwrap_or_default();
    let q_lower = q.map(|s| s.trim().to_lowercase()).filter(|s| !s.is_empty());
    let tag_lower = tag.map(|s| s.trim().to_lowercase()).filter(|s| !s.is_empty());

    let mut hits: Vec<SearchHit> = Vec::new();
    for e in entries {
        let tags = all_tags.get(&e.name).cloned().unwrap_or_default();
        if let Some(ref ql) = q_lower {
            let matched = e.name.to_lowercase().contains(ql)
                || e.title.to_lowercase().contains(ql)
                || e.artist.to_lowercase().contains(ql)
                || e.album.to_lowercase().contains(ql);
            if !matched {
                continue;
            }
        }
        if let Some(ref tl) = tag_lower {
            if !tags.iter().any(|t| t.to_lowercase() == *tl) {
                continue;
            }
        }
        hits.push(SearchHit {
            path: e.path,
            name: e.name,
            title: e.title,
            artist: e.artist,
            album: e.album,
            duration: e.duration,
            size: e.size,
            tags,
        });
        if hits.len() >= limit {
            break;
        }
    }
    Ok(hits)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn touch(dir: &Path, name: &str, content: &[u8]) {
        fs::write(dir.join(name), content).unwrap();
    }

    #[test]
    fn test_index_and_search_by_filename() {
        let dir = TempDir::new().unwrap();
        let mf = dir.path().to_str().unwrap();
        touch(dir.path(), "Hello World.mp3", b"not really audio");
        touch(dir.path(), "Other Song.flac", b"also not audio");

        let hits = search(mf, Some("hello"), None, 50).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].name, "Hello World.mp3");
        assert_eq!(hits[0].path, "Hello World.mp3");
    }

    #[test]
    fn test_search_by_tag() {
        let dir = TempDir::new().unwrap();
        let mf = dir.path().to_str().unwrap();
        touch(dir.path(), "a.mp3", b"x");
        touch(dir.path(), "b.mp3", b"y");
        crate::core::tags::set_tags(mf, "a.mp3", &["Rock".into()]).unwrap();

        let hits = search(mf, None, Some("rock"), 50).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].name, "a.mp3");
        assert_eq!(hits[0].tags, vec!["Rock".to_string()]);
    }

    #[test]
    fn test_index_reuse_and_refresh() {
        let dir = TempDir::new().unwrap();
        let mf = dir.path().to_str().unwrap();
        touch(dir.path(), "a.mp3", b"x");
        let first = build_index(mf).unwrap();
        assert_eq!(first.len(), 1);
        // Unchanged file: entry reused, index stays valid.
        let second = build_index(mf).unwrap();
        assert_eq!(second.len(), 1);
        assert_eq!(second[0].mtime, first[0].mtime);
        // Removed file drops out of the index.
        fs::remove_file(dir.path().join("a.mp3")).unwrap();
        let third = build_index(mf).unwrap();
        assert!(third.is_empty());
    }

    #[test]
    fn test_search_limit() {
        let dir = TempDir::new().unwrap();
        let mf = dir.path().to_str().unwrap();
        for i in 0..5 {
            touch(dir.path(), &format!("song{}.mp3", i), b"x");
        }
        let hits = search(mf, Some("song"), None, 3).unwrap();
        assert_eq!(hits.len(), 3);
    }
}
