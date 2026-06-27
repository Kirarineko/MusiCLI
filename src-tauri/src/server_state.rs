use std::sync::atomic::AtomicBool;
use std::sync::Mutex;

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
