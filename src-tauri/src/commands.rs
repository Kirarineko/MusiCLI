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
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let path = std::path::Path::new(&dest_dir).join(entry.name());
        if entry.is_dir() {
            fs::create_dir_all(&path).map_err(|e| e.to_string())?;
        } else {
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut out = fs::File::create(&path).map_err(|e| e.to_string())?;
            let mut buf = Vec::new();
            entry.read_to_end(&mut buf).map_err(|e| e.to_string())?;
            out.write_all(&buf).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

// --- Config ---
#[tauri::command]
pub fn read_config(key: String) -> Result<serde_json::Value, String> {
    let music_folder = {
        let path = core::files::config_path(""); // fallback
        // Try to get from env or use music folder logic
        std::env::var("MUSICLI_HTTP_PORT").ok(); // just to probe
        // Use the actual music folder from wherever it's stored
        let dirs = dirs::config_dir();
        dirs.map(|d| d.to_string_lossy().to_string()).unwrap_or_default()
    };
    // For Tauri, config is managed by the frontend configStore
    // This is a thin wrapper for the existing behavior
    Err("Config read via Tauri commands is deprecated; use settings directly".into())
}

#[tauri::command]
pub fn write_config(key: String, value: String) -> Result<(), String> {
    let _ = (key, value);
    // Config writes are handled by the frontend configStore
    Ok(())
}

// --- Server control (GUI command) ---
#[cfg(feature = "server")]
static SERVER_THREAD: std::sync::Mutex<Option<std::thread::JoinHandle<()>>> = std::sync::Mutex::new(None);
#[cfg(feature = "server")]
static SERVER_PORT: std::sync::Mutex<u16> = std::sync::Mutex::new(0);

#[tauri::command]
pub fn server_start(app_handle: tauri::AppHandle) -> Result<String, String> {
    #[cfg(feature = "server")]
    {
        let mut guard = SERVER_THREAD.lock().map_err(|e| e.to_string())?;
        if guard.is_some() {
            return Err("Server already running".into());
        }

        let state = std::sync::Arc::new(std::sync::Mutex::new(
            crate::server_state::ServerState::new(),
        ));
        let port = crate::server::http::start_in_background(state, 0);

        *SERVER_PORT.lock().map_err(|e| e.to_string())? = port;
        *guard = None; // Thread is detached in start_in_background

        std::env::set_var("MUSICLI_HTTP_PORT", port.to_string());

        // Send port to frontend
        let _ = app_handle.emit("server:started", serde_json::json!({ "port": port }));

        Ok(format!("Server started on http://127.0.0.1:{}", port))
    }
    #[cfg(not(feature = "server"))]
    {
        Err("Server feature not compiled. Rebuild with --features server".into())
    }
}

#[tauri::command]
pub fn server_stop() -> Result<String, String> {
    #[cfg(feature = "server")]
    {
        let port = *SERVER_PORT.lock().map_err(|e| e.to_string())?;
        if port == 0 {
            return Err("Server is not running".into());
        }
        // The server thread is detached; we just mark it as stopped
        *SERVER_PORT.lock().map_err(|e| e.to_string())? = 0;
        std::env::remove_var("MUSICLI_HTTP_PORT");
        Ok("Server stopped".into())
    }
    #[cfg(not(feature = "server"))]
    {
        Err("Server feature not compiled".into())
    }
}

#[tauri::command]
pub fn server_status() -> Result<String, String> {
    #[cfg(feature = "server")]
    {
        let port = *SERVER_PORT.lock().map_err(|e| e.to_string())?;
        if port > 0 {
            Ok(format!("Running on http://127.0.0.1:{}", port))
        } else {
            Ok("Not running".into())
        }
    }
    #[cfg(not(feature = "server"))]
    {
        Ok("Server feature not compiled".into())
    }
}
