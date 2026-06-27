use axum::{
    extract::{Query, State as AxumState},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};

use crate::audio::AudioMode;
use crate::server_state::ServerState as SState;

type SharedState = Arc<Mutex<SState>>;

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
) -> Result<Json<crate::metadata_cmd::MetadataResult>, (StatusCode, String)> {
    crate::metadata_cmd::read_metadata_sync(&q.path)
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
    crate::fs_cmd::list_audio_files_sync(&q.dir)
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
