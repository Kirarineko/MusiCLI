use axum::{
    extract::{Query, State as AxumState},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::Path;
use std::sync::{Arc, Mutex};

use crate::audio::AudioMode;
use crate::server_state::ServerState as SState;

type SharedState = Arc<Mutex<SState>>;

pub fn start_in_background(state: Arc<Mutex<SState>>, port: u16) -> u16 {
    let addr = format!("127.0.0.1:{}", port);
    let listener = TcpListener::bind(&addr).expect("Failed to bind HTTP server");
    let port = listener.local_addr().unwrap().port();
    let listener = tokio::net::TcpListener::from_std(listener).expect("Failed to convert listener");

    let s = state.clone();
    std::thread::spawn(move || {
        let rt = tokio::runtime::Runtime::new().expect("Failed to create tokio runtime");
        rt.block_on(async {
            axum::serve(listener, build_router(s)).await.expect("HTTP server error");
        });
    });

    port
}

pub fn build_router(state: Arc<Mutex<SState>>) -> Router {
    Router::new()
        .route("/status", get(status))
        .route("/play", post(play))
        .route("/pause", post(pause))
        .route("/stop", post(stop))
        .route("/next", post(next_track))
        .route("/prev", post(prev_track))
        .route("/seek", post(seek))
        .route("/volume", post(volume))
        .route("/mode", post(mode))
        .route("/playlist", get(get_playlist).post(add_playlist))
        .route("/metadata", get(metadata))
        .route("/files", get(list_files))
        .route("/devices", get(devices))
        .route("/audio-mode", get(get_audio_mode).post(set_audio_mode))
        .route("/config", get(get_config).put(put_config))
        .route("/lyrics", get(search_lyrics))
        .route("/lyrics/offsets", get(get_lyrics_offsets).post(set_lyrics_offset))
        .route("/files/list", get(list_dir_files))
        .route("/files/read", get(read_file_base64))
        .route("/sync/export", post(export_sync))
        .route("/sync/import", post(import_sync))
        .with_state(state)
}

#[derive(Serialize)]
struct StatusResponse {
    playing: bool,
    position: f64,
    duration: f64,
    volume: u32,
    mode: String,
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
    Json(StatusResponse {
        playing: engine.is_playing(),
        position: engine.get_position(),
        duration: engine.get_duration(),
        volume: engine.get_volume(),
        mode: engine.get_mode().to_string(),
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
    Ok(Json(StatusResponse {
        playing: true,
        position: pos,
        duration: dur,
        volume: engine.get_volume(),
        mode: engine.get_mode().to_string(),
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
    let idx = if cur + 1 < playlist.len() { cur + 1 } else { 0 };
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
    let idx = if cur > 0 { cur - 1 } else { playlist.len().saturating_sub(1) };
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
        .ok_or_else(|| (StatusCode::BAD_REQUEST, format!("Unknown mode: {}", req.mode)))?;
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
        .ok_or_else(|| (StatusCode::BAD_REQUEST, format!("Unknown mode: {}", req.mode)))?;
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

#[derive(Deserialize)]
struct LrcOffsetsQuery {
    lrc_dir: String,
}

async fn get_lyrics_offsets(
    state: AxumState<SharedState>,
    Query(q): Query<LrcOffsetsQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    // music_folder is available but lrc_dir is explicit
    let _ = state;
    let offsets = crate::core::lyrics::read_lrc_offsets(&q.lrc_dir)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
    Ok(Json(serde_json::json!(offsets)))
}

#[derive(Deserialize)]
struct LrcOffsetWriteRequest {
    lrc_dir: String,
    track_name: String,
    offset_ms: i64,
}

async fn set_lyrics_offset(
    state: AxumState<SharedState>,
    Json(req): Json<LrcOffsetWriteRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    let _ = state;
    crate::core::lyrics::write_lrc_offset(&req.lrc_dir, &req.track_name, req.offset_ms)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
    Ok(StatusCode::OK)
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
    let s = state.lock().unwrap();
    let mf = s.music_folder.lock().unwrap().clone();
    drop(s);

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
