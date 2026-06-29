use axum::{
    extract::{Query, State as AxumState},
    http::StatusCode,
    routing::{get, post, put},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use tower_http::cors::CorsLayer;
use std::fs;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::Path;
use std::str::FromStr;
use std::sync::{Arc, Mutex};

use crate::audio::AudioMode;
use crate::lrc_parser;
use crate::server_state::ServerState as SState;

type SharedState = Arc<Mutex<SState>>;

/// Starting port for the HTTP server. If occupied, increments until a free
/// port is found (52013 → 52014 → 52015 → …).
pub const START_PORT: u16 = 52013;
const MAX_PORT_ATTEMPTS: u16 = 100;

pub fn start_in_background(state: Arc<Mutex<SState>>, bind: &str, port: u16) -> u16 {
    // If the caller passes 0, use the default starting port.
    let start_port = if port == 0 { START_PORT } else { port };

    // Try ports sequentially until we find a free one.
    // We bind a probe socket to test availability, then drop it and rebind
    // inside the tokio runtime (from_std causes Linux socket errors).
    let actual_port = {
        let mut found: Option<u16> = None;
        for p in start_port..start_port.saturating_add(MAX_PORT_ATTEMPTS) {
            match TcpListener::bind(format!("{}:{}", bind, p)) {
                Ok(listener) => {
                    found = Some(listener.local_addr().unwrap().port());
                    drop(listener);
                    break;
                }
                Err(_) => continue,
            }
        }
        found.unwrap_or_else(|| panic!(
            "Failed to bind HTTP server: no free port in range {}-{}",
            start_port,
            start_port.saturating_add(MAX_PORT_ATTEMPTS - 1),
        ))
    };

    // Log the connection info so external tools can auto-discover the server.
    eprintln!("[server] HTTP API listening on http://{}:{}", bind, actual_port);

    let bind_addr = bind.to_string();
    let s = state.clone();
    std::thread::spawn(move || {
        let rt = tokio::runtime::Runtime::new().expect("Failed to create tokio runtime");
        rt.block_on(async {
            let listener = tokio::net::TcpListener::bind(format!("{}:{}", bind_addr, actual_port))
                .await
                .expect("Failed to bind HTTP server");
            axum::serve(listener, build_router(s)).await.expect("HTTP server error");
        });
    });

    actual_port
}

pub fn build_router(state: Arc<Mutex<SState>>) -> Router {
    Router::new()
        .route("/status", get(status))
        .route("/status/position", get(status_position))
        .route("/status/duration", get(status_duration))
        .route("/play", post(play))
        .route("/pause", post(pause))
        .route("/stop", post(stop))
        .route("/next", post(next_track))
        .route("/prev", post(prev_track))
        .route("/seek", post(seek))
        .route("/volume", post(volume))
        .route("/mode", post(mode))
        .route("/play-mode", get(get_play_mode).post(set_play_mode))
        .route("/playlist", get(get_playlist).post(add_playlist))
        .route("/playlists", get(list_playlists).post(create_playlist))
        .route("/playlists/single", get(get_playlist_single).delete(delete_playlist_single).put(update_playlist_single))
        .route("/playlists/switch", post(switch_playlist))
        .route("/playlists/refresh", post(refresh_playlist))
        .route("/metadata", get(metadata))
        .route("/files", get(list_files))
        .route("/devices", get(devices))
        .route("/audio-mode", get(get_audio_mode).post(set_audio_mode))
        .route("/config", get(get_config).put(put_config))
        .route("/lyrics", get(search_lyrics))
        .route("/lyrics/offsets", get(get_lyrics_offsets).post(set_lyrics_offset))
        .route("/lyrics/parse", get(parse_lyrics))
        .route("/files/list", get(list_dir_files))
        .route("/files/read", get(read_file_base64))
        .route("/sync/export", post(export_sync))
        .route("/sync/import", post(import_sync))
        .route("/folder", put(set_folder))
        .with_state(state)
        .layer(CorsLayer::permissive())
}

#[derive(Serialize)]
struct StatusResponse {
    playing: bool,
    position: f64,
    duration: f64,
    volume: u32,
    mode: String,
    play_mode: String,
    current_index: Option<usize>,
    playlist_len: usize,
    current_track: Option<String>,
}

async fn status(state: AxumState<SharedState>) -> Json<StatusResponse> {
    let s = state.lock().unwrap();
    let engine = s.audio_engine.lock().unwrap();
    let idx = *s.current_index.lock().unwrap();
    let track = idx.and_then(|i| s.playlist.lock().unwrap().get(i).cloned());
    let plen = s.playlist.lock().unwrap().len();
    let pm = s.play_mode.lock().unwrap().clone();
    Json(StatusResponse {
        playing: engine.is_playing(),
        position: engine.get_position(),
        duration: engine.get_duration(),
        volume: engine.get_volume(),
        mode: engine.get_mode().to_string(),
        play_mode: pm,
        current_index: idx,
        playlist_len: plen,
        current_track: track,
    })
}

#[derive(Deserialize)]
struct PlayRequest {
    path: Option<String>,
    index: Option<usize>,
}

async fn play(
    state: AxumState<SharedState>,
    Json(req): Json<PlayRequest>,
) -> Result<Json<StatusResponse>, (StatusCode, String)> {
    let s = state.lock().unwrap();
    let playlist = s.playlist.lock().unwrap().clone();
    let idx = if let Some(i) = req.index {
        if i >= playlist.len() {
            // 触发错误: drop s 后重试是不可行的，直接返回错误
            return Err((StatusCode::BAD_REQUEST, "Index out of range".into()));
        }
        i
    } else if let Some(ref path) = req.path {
        let pos = playlist.iter().position(|p| p == path);
        pos.unwrap_or(0)
    } else {
        s.current_index.lock().unwrap().unwrap_or(0)
    };
    if playlist.is_empty() {
        return Err((StatusCode::NOT_FOUND, "Playlist is empty".into()));
    }
    let path = playlist[idx].clone();
    drop(playlist);
    let mut engine = s.audio_engine.lock().unwrap();
    engine.play(&path).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
    *s.current_index.lock().unwrap() = Some(idx);
    let dur = engine.get_duration();
    let pos = engine.get_position();
    let plen = s.playlist.lock().unwrap().len();
    let pm = s.play_mode.lock().unwrap().clone();
    Ok(Json(StatusResponse {
        playing: true,
        position: pos,
        duration: dur,
        volume: engine.get_volume(),
        mode: engine.get_mode().to_string(),
        play_mode: pm,
        current_index: Some(idx),
        playlist_len: plen,
        current_track: Some(path),
    }))
}

async fn pause(state: AxumState<SharedState>) -> Result<StatusCode, (StatusCode, String)> {
    let s = state.lock().unwrap();
    let engine = s.audio_engine.lock().unwrap();
    engine.pause();
    Ok(StatusCode::OK)
}

async fn stop(state: AxumState<SharedState>) -> Result<StatusCode, (StatusCode, String)> {
    let s = state.lock().unwrap();
    let mut engine = s.audio_engine.lock().unwrap();
    engine.stop();
    Ok(StatusCode::OK)
}

async fn next_track(state: AxumState<SharedState>) -> Result<Json<StatusResponse>, (StatusCode, String)> {
    let s = state.lock().unwrap();
    let playlist = s.playlist.lock().unwrap().clone();
    if playlist.is_empty() {
        return Err((StatusCode::NOT_FOUND, "Playlist empty".into()));
    }
    let cur = s.current_index.lock().unwrap().unwrap_or(0);
    let pm = s.play_mode.lock().unwrap().clone();

    let idx = match pm.as_str() {
        "repeat-one" => cur,
        "shuffle" => {
            // Pick a random index different from the current one.
            if playlist.len() == 1 {
                cur
            } else {
                use std::collections::HashSet;
                let mut picked: HashSet<usize> = HashSet::new();
                picked.insert(cur);
                let mut result = cur;
                let mut seed = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_nanos() as u64)
                    .unwrap_or(0)
                    .wrapping_add(cur as u64);
                while picked.len() < playlist.len() {
                    seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
                    let cand = (seed as usize) % playlist.len();
                    if picked.insert(cand) { result = cand; break; }
                }
                result
            }
        }
        // "normal" and "repeat-all": advance, stop at end for "normal".
        _ => {
            if cur + 1 < playlist.len() {
                cur + 1
            } else if pm == "repeat-all" {
                0
            } else {
                // normal mode at end — stop playback.
                let mut engine = s.audio_engine.lock().unwrap();
                engine.stop();
                *s.current_index.lock().unwrap() = None;
                let plen = playlist.len();
                return Ok(Json(StatusResponse {
                    playing: false,
                    position: 0.0,
                    duration: engine.get_duration(),
                    volume: engine.get_volume(),
                    mode: engine.get_mode().to_string(),
                    play_mode: pm,
                    current_index: None,
                    playlist_len: plen,
                    current_track: None,
                }));
            }
        }
    };

    let path = playlist[idx].clone();
    drop(playlist);
    let mut engine = s.audio_engine.lock().unwrap();
    engine.play(&path).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
    *s.current_index.lock().unwrap() = Some(idx);
    let plen = s.playlist.lock().unwrap().len();
    Ok(Json(StatusResponse {
        playing: true,
        position: engine.get_position(),
        duration: engine.get_duration(),
        volume: engine.get_volume(),
        mode: engine.get_mode().to_string(),
        play_mode: pm,
        current_index: Some(idx),
        playlist_len: plen,
        current_track: Some(path),
    }))
}

async fn prev_track(state: AxumState<SharedState>) -> Result<Json<StatusResponse>, (StatusCode, String)> {
    let s = state.lock().unwrap();
    let playlist = s.playlist.lock().unwrap().clone();
    if playlist.is_empty() {
        return Err((StatusCode::NOT_FOUND, "Playlist empty".into()));
    }
    let cur = s.current_index.lock().unwrap().unwrap_or(0);
    let pm = s.play_mode.lock().unwrap().clone();
    let idx = match pm.as_str() {
        "repeat-one" => cur,
        "shuffle" => {
            if playlist.len() == 1 { cur } else {
                let mut seed = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_nanos() as u64)
                    .unwrap_or(0)
                    .wrapping_add((cur as u64).wrapping_mul(2654435761));
                let mut chosen = cur;
                while chosen == cur {
                    seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
                    chosen = (seed as usize) % playlist.len();
                }
                chosen
            }
        }
        _ => if cur > 0 { cur - 1 } else { playlist.len().saturating_sub(1) },
    };
    let path = playlist[idx].clone();
    drop(playlist);
    let mut engine = s.audio_engine.lock().unwrap();
    engine.play(&path).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
    *s.current_index.lock().unwrap() = Some(idx);
    let plen = s.playlist.lock().unwrap().len();
    Ok(Json(StatusResponse {
        playing: true,
        position: engine.get_position(),
        duration: engine.get_duration(),
        volume: engine.get_volume(),
        mode: engine.get_mode().to_string(),
        play_mode: pm,
        current_index: Some(idx),
        playlist_len: plen,
        current_track: Some(path),
    }))
}

#[derive(Deserialize)]
struct SeekRequest {
    seconds: f64,
}

async fn seek(
    state: AxumState<SharedState>,
    Json(req): Json<SeekRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    let s = state.lock().unwrap();
    let engine = s.audio_engine.lock().unwrap();
    engine.seek(req.seconds);
    Ok(StatusCode::OK)
}

#[derive(Deserialize)]
struct VolumeRequest {
    level: u32,
}

async fn volume(
    state: AxumState<SharedState>,
    Json(req): Json<VolumeRequest>,
) -> Result<Json<u32>, (StatusCode, String)> {
    let s = state.lock().unwrap();
    let engine = s.audio_engine.lock().unwrap();
    engine.set_volume(req.level.min(100));
    Ok(Json(engine.get_volume()))
}

#[derive(Deserialize)]
struct ModeRequest {
    mode: String,
}

async fn mode(
    state: AxumState<SharedState>,
    Json(req): Json<ModeRequest>,
) -> Result<Json<String>, (StatusCode, String)> {
    let s = state.lock().unwrap();
    let mut engine = s.audio_engine.lock().unwrap();
    let am = AudioMode::from_str(&req.mode)
        .map_err(|e| (StatusCode::BAD_REQUEST, e))?;
    engine.set_mode(am);
    Ok(Json(engine.get_mode().to_string()))
}

async fn get_playlist(state: AxumState<SharedState>) -> Json<Vec<String>> {
    let s = state.lock().unwrap();
    let pl = s.playlist.lock().unwrap().clone();
    Json(pl)
}

#[derive(Deserialize)]
struct PlaylistRequest {
    paths: Vec<String>,
}

async fn add_playlist(
    state: AxumState<SharedState>,
    Json(req): Json<PlaylistRequest>,
) -> Result<Json<usize>, (StatusCode, String)> {
    let s = state.lock().unwrap();
    let mut pl = s.playlist.lock().unwrap();
    for p in &req.paths {
        if !pl.contains(p) {
            pl.push(p.clone());
        }
    }
    Ok(Json(pl.len()))
}

#[derive(Deserialize)]
struct MetadataQuery {
    path: String,
}

async fn metadata(
    Query(q): Query<MetadataQuery>,
) -> Result<Json<crate::core::metadata::MetadataResult>, (StatusCode, String)> {
    // Restrict to audio files to prevent arbitrary file probing via HTTP.
    if !crate::core::files::is_audio_file(std::path::Path::new(&q.path)) {
        return Err((StatusCode::FORBIDDEN, "Only audio files are allowed".into()));
    }
    crate::core::metadata::read_metadata(&q.path)
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))
}

#[derive(Deserialize)]
struct FilesQuery {
    dir: String,
}

async fn list_files(
    Query(q): Query<FilesQuery>,
) -> Result<Json<Vec<String>>, (StatusCode, String)> {
    crate::core::files::list_audio_files(&q.dir)
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))
}

async fn devices() -> Result<Json<Vec<String>>, (StatusCode, String)> {
    use cpal::traits::{DeviceTrait, HostTrait};
    let host = cpal::default_host();
    let devices = host
        .output_devices()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let names: Vec<String> = devices
        .filter_map(|d| d.description().ok().map(|desc| desc.name().to_string()))
        .collect();
    Ok(Json(names))
}

async fn get_audio_mode(state: AxumState<SharedState>) -> Json<String> {
    let s = state.lock().unwrap();
    let engine = s.audio_engine.lock().unwrap();
    Json(engine.get_mode().to_string())
}

async fn set_audio_mode(
    state: AxumState<SharedState>,
    Json(req): Json<ModeRequest>,
) -> Result<Json<String>, (StatusCode, String)> {
    let s = state.lock().unwrap();
    let mut engine = s.audio_engine.lock().unwrap();
    let am = AudioMode::from_str(&req.mode)
        .map_err(|e| (StatusCode::BAD_REQUEST, e))?;
    engine.set_mode(am);
    Ok(Json(engine.get_mode().to_string()))
}

// ── Config ──────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct ConfigKeyQuery {
    key: String,
}

async fn get_config(
    state: AxumState<SharedState>,
    Query(q): Query<ConfigKeyQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let s = state.lock().unwrap();
    let mf = s.music_folder.lock().unwrap().clone();
    crate::core::files::read_config(&mf, &q.key)
        .map(|v| Json(v.unwrap_or(serde_json::Value::Null)))
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))
}

async fn put_config(
    state: AxumState<SharedState>,
    Query(q): Query<ConfigKeyQuery>,
    Json(data): Json<serde_json::Value>,
) -> Result<StatusCode, (StatusCode, String)> {
    let s = state.lock().unwrap();
    let mf = s.music_folder.lock().unwrap().clone();
    crate::core::files::write_config(&mf, &q.key, &data)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
    Ok(StatusCode::OK)
}

// ── Lyrics ──────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct LyricsQuery {
    audio_path: String,
}

async fn search_lyrics(
    state: AxumState<SharedState>,
    Query(q): Query<LyricsQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let s = state.lock().unwrap();
    let mf = s.music_folder.lock().unwrap().clone();
    let result = crate::core::lyrics::find_lrc(&q.audio_path, &mf)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
    Ok(Json(serde_json::json!({ "lrc_path": result })))
}

async fn get_lyrics_offsets(
    state: AxumState<SharedState>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    // Derive lrc_dir from music_folder/lrc — never trust client-supplied paths.
    let s = state.lock().unwrap();
    let mf = s.music_folder.lock().unwrap().clone();
    let lrc_dir = Path::new(&mf).join("lrc");
    let lrc_dir_str = lrc_dir.to_string_lossy().to_string();
    let offsets = crate::core::lyrics::read_lrc_offsets(&lrc_dir_str)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
    Ok(Json(serde_json::json!(offsets)))
}

#[derive(Deserialize)]
struct LrcOffsetWriteRequest {
    track_name: String,
    offset_ms: i64,
}

async fn set_lyrics_offset(
    state: AxumState<SharedState>,
    Json(req): Json<LrcOffsetWriteRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    // Derive lrc_dir from music_folder/lrc — never trust client-supplied paths.
    let s = state.lock().unwrap();
    let mf = s.music_folder.lock().unwrap().clone();
    let lrc_dir = Path::new(&mf).join("lrc");
    let lrc_dir_str = lrc_dir.to_string_lossy().to_string();
    crate::core::lyrics::write_lrc_offset(&lrc_dir_str, &req.track_name, req.offset_ms)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
    Ok(StatusCode::OK)
}

#[derive(Deserialize)]
struct LyricsParseQuery {
    audio_path: Option<String>,
    lrc_path: Option<String>,
}

async fn parse_lyrics(
    state: AxumState<SharedState>,
    Query(q): Query<LyricsParseQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let lrc_path = if let Some(p) = q.lrc_path {
        p
    } else if let Some(audio_path) = q.audio_path {
        let s = state.lock().unwrap();
        let mf = s.music_folder.lock().unwrap().clone();
        crate::core::lyrics::find_lrc(&audio_path, &mf)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?
            .ok_or_else(|| (StatusCode::NOT_FOUND, "No LRC file found".into()))?
    } else {
        return Err((StatusCode::BAD_REQUEST, "audio_path or lrc_path required".into()));
    };

    let content = std::fs::read_to_string(&lrc_path)
        .map_err(|e| (StatusCode::NOT_FOUND, format!("Failed to read LRC: {}", e)))?;
    let lines = lrc_parser::parse_lrc(&content);
    Ok(Json(serde_json::json!(lines)))
}

// ── Files ───────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct DirQuery {
    dir: String,
}

async fn list_dir_files(
    Query(q): Query<DirQuery>,
) -> Result<Json<Vec<String>>, (StatusCode, String)> {
    crate::core::files::list_audio_files(&q.dir)
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))
}

#[derive(Deserialize)]
struct PathQuery {
    path: String,
}

async fn read_file_base64(
    Query(q): Query<PathQuery>,
) -> Result<Json<String>, (StatusCode, String)> {
    // Restrict to audio files: the HTTP API is network-exposed (0.0.0.0)
    // and must not allow arbitrary file exfiltration.
    if !crate::core::files::is_audio_file(std::path::Path::new(&q.path)) {
        return Err((StatusCode::FORBIDDEN, "Only audio files are allowed".into()));
    }
    crate::core::files::read_file_base64(&q.path)
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))
}

// ── Sync ────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct SyncExportRequest {
    dest_zip: String,
    #[serde(default)]
    playlist_names: Vec<String>,
}

async fn export_sync(
    state: AxumState<SharedState>,
    Json(req): Json<SyncExportRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    // Validate destination path: reject obvious system paths and require it
    // live under the user's home or music folder.
    let home = dirs::home_dir().map(|h| h.to_path_buf());
    let s = state.lock().unwrap();
    let mf = s.music_folder.lock().unwrap().clone();
    drop(s);

    let dest = Path::new(&req.dest_zip);
    let dest_canon = fs::canonicalize(dest).unwrap_or_else(|_| dest.to_path_buf());
    let is_safe = match (&home, mf.is_empty()) {
        (Some(h), true) => dest_canon.starts_with(h),
        (Some(h), false) => dest_canon.starts_with(h) || dest_canon.starts_with(&mf),
        (None, _) => true, // can't determine home — allow but log
    };
    if !is_safe {
        return Err((StatusCode::FORBIDDEN, "Export destination outside allowed directories".into()));
    }

    // Build a lightweight export: read playlists, filter if needed, write JSON, zip it
    use crate::core::playlist::{get_playlist, list_playlists};
    let infos = list_playlists(&mf)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
    let names_to_export: Vec<String> = if req.playlist_names.is_empty() {
        infos.iter().map(|i| i.name.clone()).collect()
    } else {
        req.playlist_names.clone()
    };

    let mut export: serde_json::Map<String, serde_json::Value> = serde_json::Map::new();
    for name in &names_to_export {
        if let Ok(Some(pl)) = get_playlist(&mf, name) {
            export.insert(name.clone(), serde_json::json!(pl));
        }
    }
    let current = crate::core::playlist::get_current_playlist_name(&mf)
        .unwrap_or_else(|_| "Default".into());
    let export_obj = serde_json::json!({
        "playlists": export,
        "current": current,
    });
    let json_bytes = serde_json::to_vec_pretty(&export_obj)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Write playlists.json into a ZIP
    if let Some(parent) = Path::new(&req.dest_zip).parent() {
        fs::create_dir_all(parent)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }
    let zip_file = fs::File::create(&req.dest_zip)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let mut zip = zip::ZipWriter::new(zip_file);
    let opts = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    zip.start_file("playlists.json", opts)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    zip.write_all(&json_bytes)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    zip.finish()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(StatusCode::OK)
}

#[derive(Deserialize)]
struct SyncImportRequest {
    zip_path: String,
}

async fn import_sync(
    state: AxumState<SharedState>,
    Json(req): Json<SyncImportRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let s = state.lock().unwrap();
    let mf = s.music_folder.lock().unwrap().clone();
    drop(s);

    let zip_file = fs::File::open(&req.zip_path)
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("Cannot open ZIP: {}", e)))?;
    let mut archive = zip::ZipArchive::new(zip_file)
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("Invalid ZIP: {}", e)))?;

    // Look for playlists.json inside the ZIP
    let mut playlist_json: Option<String> = None;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        if entry.name() == "playlists.json" {
            let mut content = String::new();
            entry.read_to_string(&mut content)
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            playlist_json = Some(content);
            break;
        }
    }

    let content = playlist_json
        .ok_or_else(|| (StatusCode::BAD_REQUEST, "No playlists.json found in ZIP".to_string()))?;
    let incoming: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("Malformed playlists.json: {}", e)))?;

    let incoming_pls = incoming
        .get("playlists")
        .and_then(|v| v.as_object());
    let mut imported_count: usize = 0;
    if let Some(pls_obj) = incoming_pls {
        for (name, pl) in pls_obj {
            let tracks: Vec<String> = pl.get("tracks")
                .and_then(|v| v.as_array())
                .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                .unwrap_or_default();
            let desc = pl.get("desc").and_then(|v| v.as_str());
            match crate::core::playlist::create_playlist(&mf, name, desc, &tracks) {
                Ok(()) => { imported_count += 1; }
                Err(e) if e == "duplicate" => { /* skip existing */ }
                Err(e) => return Err((StatusCode::INTERNAL_SERVER_ERROR, e)),
            }
        }
    }
    Ok(Json(serde_json::json!({ "imported": imported_count })))
}

// ── Status sub-routes ────────────────────────────────────────────────

async fn status_position(state: AxumState<SharedState>) -> Json<f64> {
    let s = state.lock().unwrap();
    let engine = s.audio_engine.lock().unwrap();
    Json(engine.get_position())
}

async fn status_duration(state: AxumState<SharedState>) -> Json<f64> {
    let s = state.lock().unwrap();
    let engine = s.audio_engine.lock().unwrap();
    Json(engine.get_duration())
}

// ── Play mode ────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct PlayModeRequest {
    mode: String,
}

const PLAY_MODES: &[&str] = &["normal", "repeat-one", "repeat-all", "shuffle"];

async fn get_play_mode(state: AxumState<SharedState>) -> Json<String> {
    let s = state.lock().unwrap();
    let pm = s.play_mode.lock().unwrap().clone();
    Json(pm)
}

async fn set_play_mode(
    state: AxumState<SharedState>,
    Json(req): Json<PlayModeRequest>,
) -> Result<Json<String>, (StatusCode, String)> {
    if !PLAY_MODES.contains(&req.mode.as_str()) {
        return Err((StatusCode::BAD_REQUEST, format!("Invalid play_mode. Must be one of: {:?}", PLAY_MODES)));
    }
    let s = state.lock().unwrap();
    *s.play_mode.lock().unwrap() = req.mode.clone();
    Ok(Json(req.mode))
}

// ── Named playlists ──────────────────────────────────────────────────

#[derive(Deserialize)]
struct CreatePlaylistRequest {
    name: String,
    #[serde(default)]
    desc: String,
    #[serde(default)]
    tracks: Vec<String>,
}

async fn list_playlists(
    state: AxumState<SharedState>,
) -> Result<Json<Vec<crate::core::playlist::PlaylistInfo>>, (StatusCode, String)> {
    let s = state.lock().unwrap();
    let mf = s.music_folder.lock().unwrap().clone();
    drop(s);
    crate::core::playlist::list_playlists(&mf)
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))
}

async fn create_playlist(
    state: AxumState<SharedState>,
    Json(req): Json<CreatePlaylistRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let s = state.lock().unwrap();
    let mf = s.music_folder.lock().unwrap().clone();
    drop(s);
    let desc = if req.desc.is_empty() { None } else { Some(req.desc.as_str()) };
    crate::core::playlist::create_playlist(&mf, &req.name, desc, &req.tracks)
        .map(|_| Json(serde_json::json!({ "created": req.name })))
        .map_err(|e| (StatusCode::CONFLICT, e))
}

#[derive(Deserialize)]
struct PlaylistNameQuery {
    name: String,
}

async fn get_playlist_single(
    state: AxumState<SharedState>,
    Query(q): Query<PlaylistNameQuery>,
) -> Result<Json<Option<crate::core::playlist::Playlist>>, (StatusCode, String)> {
    let s = state.lock().unwrap();
    let mf = s.music_folder.lock().unwrap().clone();
    drop(s);
    crate::core::playlist::get_playlist(&mf, &q.name)
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))
}

async fn delete_playlist_single(
    state: AxumState<SharedState>,
    Query(q): Query<PlaylistNameQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let s = state.lock().unwrap();
    let mf = s.music_folder.lock().unwrap().clone();
    drop(s);
    crate::core::playlist::delete_playlist(&mf, &q.name)
        .map(|_| Json(serde_json::json!({ "deleted": q.name })))
        .map_err(|e| (StatusCode::CONFLICT, e))
}

#[derive(Deserialize)]
struct UpdatePlaylistRequest {
    #[serde(default)]
    name: String,
    #[serde(default)]
    desc: String,
    #[serde(default)]
    tracks: Option<Vec<String>>,
}

async fn update_playlist_single(
    state: AxumState<SharedState>,
    Query(q): Query<PlaylistNameQuery>,
    Json(req): Json<UpdatePlaylistRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let s = state.lock().unwrap();
    let mf = s.music_folder.lock().unwrap().clone();
    drop(s);
    let new_name = if req.name.is_empty() || req.name == q.name { None } else { Some(req.name.as_str()) };
    let desc = if req.desc.is_empty() { None } else { Some(req.desc.as_str()) };
    let tracks = req.tracks.as_deref();
    crate::core::playlist::update_playlist(&mf, &q.name, new_name, desc, tracks)
        .map(|_| Json(serde_json::json!({ "updated": q.name })))
        .map_err(|e| (StatusCode::CONFLICT, e))
}

async fn switch_playlist(
    state: AxumState<SharedState>,
    Json(req): Json<PlaylistNameQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let s = state.lock().unwrap();
    let mf = s.music_folder.lock().unwrap().clone();
    // Verify the playlist exists and is non-empty BEFORE writing current to disk.
    // This avoids the inconsistent state where the file says current=X but we
    // return 404 to the caller.
    let pl = crate::core::playlist::get_playlist(&mf, &req.name)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?
        .ok_or_else(|| (StatusCode::NOT_FOUND, format!("Playlist '{}' not found", req.name)))?;
    if pl.tracks.is_empty() {
        return Err((StatusCode::NOT_FOUND, format!("Playlist '{}' is empty", req.name)));
    }
    crate::core::playlist::switch_playlist(&mf, &req.name)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
    match crate::server_state::load_current_playlist(&s) {
        Ok(len) => {
            Ok(Json(serde_json::json!({
                "switched": req.name,
                "track_count": len,
            })))
        }
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e)),
    }
}

async fn refresh_playlist(
    state: AxumState<SharedState>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let s = state.lock().unwrap();
    let count = crate::server_state::load_current_playlist(&s)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
    Ok(Json(serde_json::json!({
        "refreshed": true,
        "track_count": count,
    })))
}

// ── Folder ───────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct FolderRequest {
    path: String,
}

async fn set_folder(
    state: AxumState<SharedState>,
    Json(req): Json<FolderRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    // Create the directory if it doesn't exist
    if let Err(e) = std::fs::create_dir_all(&req.path) {
        return Err((StatusCode::BAD_REQUEST, format!("Cannot create directory: {}", e)));
    }
    let s = state.lock().unwrap();
    *s.music_folder.lock().unwrap() = req.path.clone();
    crate::core::files::persist_music_folder(&req.path);
    let _ = crate::server_state::load_current_playlist(&s);
    Ok(StatusCode::OK)
}
