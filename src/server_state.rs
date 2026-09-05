use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex, OnceLock};

use crate::audio::engine::AudioEngine;
use crate::lrc_parser::LrcLine;

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct NamedPlaylist {
    pub name: String,
    pub desc: String,
    pub created_at: String,
    pub tracks: Vec<String>,
}

pub struct ServerState {
    /// Arc so heavy engine operations (play/stop — they block on decode
    /// probing and stream setup) can be performed *without* holding the
    /// outer ServerState lock, keeping other commands responsive.
    pub audio_engine: Arc<Mutex<AudioEngine>>,
    pub playlist: Mutex<Vec<String>>,
    pub current_index: Mutex<Option<usize>>,
    // Named playlists
    pub playlists: Mutex<Vec<NamedPlaylist>>,
    pub current_pl: Mutex<String>,
    pub music_folder: Mutex<String>,
    // Lyrics
    pub lrc_lines: Mutex<Vec<LrcLine>>,
    pub lrc_loaded_for: Mutex<String>,
    pub lrc_last_idx: Mutex<i32>,
    pub lrc_enabled: Mutex<bool>,
    pub lrc_next_count: Mutex<usize>,
    // Playback
    pub play_mode: Mutex<String>,
    pub volume: u32,
    pub audio_mode: String,
    // Progress bar
    pub progress_width: u32,
    pub progress_filled: char,
    pub progress_empty: char,
    // Status bar thread control
    pub status_running: AtomicBool,
    /// Optional HTTP API token (set via `--token`). When Some and non-empty,
    /// every HTTP request must carry it (Bearer header or `?token=`).
    pub api_token: Option<String>,
    /// Optional password protecting the /pocket WebUI (independent of
    /// api_token). Set via the GUI `pocket pw` command; persisted in
    /// {music_folder}/config/pocket.json alongside the webui selection.
    pub pocket_password: Mutex<Option<String>>,
}

impl Default for ServerState {
    fn default() -> Self {
        Self::new()
    }
}

impl ServerState {
    pub fn new() -> Self {
        Self {
            audio_engine: Arc::new(Mutex::new(AudioEngine::new())),
            playlist: Mutex::new(Vec::new()),
            current_index: Mutex::new(None),
            playlists: Mutex::new(vec![NamedPlaylist {
                name: "Default".into(),
                desc: String::new(),
                created_at: String::new(),
                tracks: Vec::new(),
            }]),
            current_pl: Mutex::new("Default".into()),
            music_folder: Mutex::new(String::new()),
            lrc_lines: Mutex::new(Vec::new()),
            lrc_loaded_for: Mutex::new(String::new()),
            lrc_last_idx: Mutex::new(-1),
            lrc_enabled: Mutex::new(true),
            lrc_next_count: Mutex::new(3),
            play_mode: Mutex::new("normal".into()),
            volume: 80,
            audio_mode: "wasapi".into(),
            progress_width: 30,
            progress_filled: '=',
            progress_empty: ' ',
            status_running: AtomicBool::new(false),
            api_token: None,
            pocket_password: Mutex::new(None),
        }
    }
}

// ── Global server state for GUI sync ─────────────────────────────────

static GLOBAL_STATE: OnceLock<Arc<Mutex<ServerState>>> = OnceLock::new();

pub fn init_global(state: Arc<Mutex<ServerState>>) {
    let _ = GLOBAL_STATE.set(state);
}

pub fn set_music_folder(path: String) {
    if let Some(state) = GLOBAL_STATE.get() {
        *state.lock().unwrap().music_folder.lock().unwrap() = path.clone();
        crate::core::files::persist_music_folder(&path);
        let guard = state.lock().unwrap();
        // The pocket password lives inside the music folder — drop the old
        // one before loading whatever the new folder's config holds.
        *guard.pocket_password.lock().unwrap() = None;
        let _ = load_current_playlist(&guard);
        load_pocket_config(&guard);
    }
}

// ── Pocket Player config ({music_folder}/config/pocket.json) ────────
//
// Shape: { "password": "…", "webui": "my.html" }
// `webui` is written by the frontend (`pocket ui`) via read/write_config, so
// `set_pocket_password` must preserve it — always read-modify-write.

pub fn read_pocket_config(music_folder: &str) -> Option<serde_json::Value> {
    if music_folder.is_empty() {
        return None;
    }
    crate::core::files::read_config(music_folder, "pocket").ok().flatten()
}

/// Load the persisted pocket password into `state`. Called once at startup
/// (both GUI and headless).
pub fn load_pocket_config(state: &ServerState) {
    let mf = state.music_folder.lock().unwrap().clone();
    if let Some(cfg) = read_pocket_config(&mf) {
        if let Some(pw) = cfg.get("password").and_then(|v| v.as_str()) {
            if !pw.is_empty() {
                *state.pocket_password.lock().unwrap() = Some(pw.to_string());
            }
        }
    }
}

/// Update the in-memory pocket password and persist it, preserving the
/// `webui` key. `None` (or an empty string) clears the password.
pub fn set_pocket_password(password: Option<String>) -> Result<(), String> {
    let state = GLOBAL_STATE
        .get()
        .ok_or_else(|| "server state not initialized".to_string())?;
    let mf = {
        let s = state.lock().unwrap();
        let folder = s.music_folder.lock().unwrap().clone();
        folder
    };
    if mf.is_empty() {
        return Err("music folder not configured".into());
    }

    let mut cfg = read_pocket_config(&mf).unwrap_or_else(|| serde_json::json!({}));
    let stored = password.clone();
    match stored {
        Some(pw) if !pw.is_empty() => {
            cfg["password"] = serde_json::json!(pw);
        }
        _ => {
            if let Some(obj) = cfg.as_object_mut() {
                obj.remove("password");
            }
        }
    }
    crate::core::files::write_config(&mf, "pocket", &cfg)?;

    *state.lock().unwrap().pocket_password.lock().unwrap() = password;
    Ok(())
}

pub fn load_current_playlist(state: &ServerState) -> Result<usize, String> {
    let mf = state.music_folder.lock().unwrap().clone();
    if mf.is_empty() {
        return Ok(0);
    }
    match crate::core::playlist::get_current_playlist_name(&mf) {
        Ok(name) => {
            if let Ok(Some(pl)) = crate::core::playlist::get_playlist(&mf, &name) {
                let len = pl.tracks.len();
                *state.playlist.lock().unwrap() = pl.tracks;
                *state.current_pl.lock().unwrap() = name;
                *state.current_index.lock().unwrap() = None;
                return Ok(len);
            }
            Ok(0)
        }
        Err(_) => Ok(0),
    }
}
