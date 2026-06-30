use crate::core;
use crate::core::metadata::MetadataResult;

// --- Metadata ---
#[tauri::command]
pub fn read_metadata(path: String) -> Result<MetadataResult, String> {
    core::metadata::read_metadata(&path)
}

// --- Files ---
#[tauri::command]
pub fn list_audio_files(dir: String) -> Result<Vec<String>, String> {
    core::files::list_audio_files(&dir)
}

#[tauri::command]
pub fn read_file_base64(path: String) -> Result<String, String> {
    core::files::read_file_base64(&path)
}

#[tauri::command]
pub fn dir_exists(path: String) -> Result<bool, String> {
    Ok(std::path::Path::new(&path).is_dir())
}

#[tauri::command]
pub fn list_listen_webuis(music_folder: String) -> Result<Vec<String>, String> {
    let dir = std::path::Path::new(&music_folder).join("Listen_WebUI");
    core::files::list_html_files(&dir.to_string_lossy())
}

#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    core::files::read_file(&path)
}

#[tauri::command]
pub fn write_file(path: String, content: String) -> Result<(), String> {
    core::files::write_file(&path, &content)
}

#[tauri::command]
pub fn copy_file(src: String, dest: String) -> Result<(), String> {
    core::files::copy_file(&src, &dest)
}

#[tauri::command]
pub fn mkdir(path: String) -> Result<(), String> {
    core::files::mkdir(&path)
}

// --- Lyrics ---
#[tauri::command]
pub fn find_lrc(audio_path: String, root_dir: String) -> Result<Option<String>, String> {
    core::lyrics::find_lrc(&audio_path, &root_dir)
}

#[tauri::command]
pub fn read_lrc_offsets(lrc_dir: String) -> Result<std::collections::HashMap<String, i64>, String> {
    core::lyrics::read_lrc_offsets(&lrc_dir)
}

#[tauri::command]
pub fn write_lrc_offset(lrc_dir: String, track_name: String, offset: i64) -> Result<(), String> {
    core::lyrics::write_lrc_offset(&lrc_dir, &track_name, offset)
}

// --- ZIP ---
#[tauri::command]
pub fn create_zip(src_dir: String, dest_path: String) -> Result<(), String> {
    use std::io::Write;
    use zip::write::FileOptions;
    use std::fs;

    let dest = std::path::Path::new(&dest_path);
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let file = fs::File::create(dest).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(file);
    let options = FileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    fn add_dir(
        zip: &mut zip::ZipWriter<std::fs::File>,
        src: &std::path::Path,
        base: &std::path::Path,
        options: &FileOptions<()>,
    ) -> Result<(), String> {
        use std::io::Read;
        for entry in std::fs::read_dir(src).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            let name = path.strip_prefix(base).unwrap().to_string_lossy().to_string();
            if path.is_dir() {
                zip.add_directory(&name, *options).map_err(|e| e.to_string())?;
                add_dir(zip, &path, base, options)?;
            } else {
                zip.start_file(&name, *options).map_err(|e| e.to_string())?;
                let mut f = fs::File::open(&path).map_err(|e| e.to_string())?;
                let mut buf = Vec::new();
                f.read_to_end(&mut buf).map_err(|e| e.to_string())?;
                zip.write_all(&buf).map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }

    let src = std::path::Path::new(&src_dir);
    add_dir(&mut zip, src, src, &options)?;
    zip.finish().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn extract_zip(zip_path: String, dest_dir: String) -> Result<(), String> {
    use std::io::{Read, Write};
    use std::fs;

    let file = fs::File::open(&zip_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;

    // Canonicalize the destination directory so we can verify every extracted
    // entry stays inside it (Zip Slip protection).
    let dest_canon = fs::canonicalize(&dest_dir)
        .or_else(|_| {
            // dest_dir may not exist yet — create it then canonicalize.
            fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;
            fs::canonicalize(&dest_dir).map_err(|e| e.to_string())
        })?;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let raw_name = entry.name();
        // Reject absolute paths and parent traversal in the entry name itself.
        if raw_name.starts_with('/') || raw_name.starts_with('\\')
            || raw_name.contains("..")
            || raw_name.chars().next().map(|c| c.is_ascii() && (c as u32) > 1 && (c as u32) < 32).unwrap_or(false)
        {
            return Err(format!("Unsafe entry name in ZIP: {}", raw_name));
        }
        let path = dest_canon.join(raw_name);

        // Verify the resolved path is still inside dest_dir (handles symlink tricks too).
        let parent = path.parent().unwrap_or(std::path::Path::new(""));
        if !parent.starts_with(&dest_canon) {
            return Err(format!("Entry escapes destination directory: {}", raw_name));
        }

        if entry.is_dir() {
            fs::create_dir_all(&path).map_err(|e| e.to_string())?;
        } else {
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut out = fs::File::create(&path).map_err(|e| e.to_string())?;
            // Stream in chunks instead of loading the whole entry into memory.
            let mut buf = vec![0u8; 64 * 1024];
            loop {
                let n = entry.read(&mut buf).map_err(|e| e.to_string())?;
                if n == 0 { break; }
                out.write_all(&buf[..n]).map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}

// --- Remote control (GUI command) ---

#[tauri::command]
pub fn remote_start() -> Result<String, String> {
    let port = std::env::var("MUSICLI_HTTP_PORT").unwrap_or_default();
    if port.is_empty() || port == "0" {
        return Err("Remote not started".into());
    }
    let host = std::env::var("MUSICLI_HOST").unwrap_or_else(|_| "0.0.0.0".to_string());
    Ok(format!("Remote API on http://{}:{}", host, port))
}

#[tauri::command]
pub fn remote_stop() -> Result<String, String> {
    Ok("Remote is managed by the application".into())
}

#[tauri::command]
pub fn remote_status() -> Result<String, String> {
    let port = std::env::var("MUSICLI_HTTP_PORT").unwrap_or_default();
    if port.is_empty() || port == "0" {
        Ok("Not running".into())
    } else {
        let host = std::env::var("MUSICLI_HOST").unwrap_or_else(|_| "0.0.0.0".to_string());
        Ok(format!("Remote API on http://{}:{}", host, port))
    }
}

#[tauri::command]
pub fn set_music_folder(path: String) {
    crate::server_state::set_music_folder(path);
}
