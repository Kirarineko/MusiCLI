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
    pub audio_engine: Mutex<AudioEngine>,
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
}

impl Default for ServerState {
    fn default() -> Self {
        Self::new()
    }
}

impl ServerState {
    pub fn new() -> Self {
        Self {
            audio_engine: Mutex::new(AudioEngine::new()),
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
            lrc_enabled: Mutex::new(false),
            lrc_next_count: Mutex::new(3),
            play_mode: Mutex::new("normal".into()),
            volume: 80,
            audio_mode: "wasapi".into(),
            progress_width: 30,
            progress_filled: '=',
            progress_empty: ' ',
            status_running: AtomicBool::new(false),
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
        let _ = load_current_playlist(&state.lock().unwrap());
    }
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
