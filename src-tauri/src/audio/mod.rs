pub mod decoder;
pub mod engine;
pub mod output;
pub mod resampler;

use serde::{Deserialize, Serialize};
#[cfg(feature = "gui")]
use tauri::command;
#[cfg(feature = "gui")]
use crate::AppState;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AudioMode {
    Wasapi,
    Asio,
}

impl std::fmt::Display for AudioMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AudioMode::Wasapi => write!(f, "normal"),
            AudioMode::Asio => write!(f, "asio"),
        }
    }
}

impl AudioMode {
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "normal" | "default" | "wasapi" => Some(AudioMode::Wasapi),
            "asio" | "exclusive" => Some(AudioMode::Asio),
            _ => None,
        }
    }
}

// --- Tauri Commands (GUI only) ---

#[cfg(feature = "gui")]
#[command]
pub async fn load_track(
    state: tauri::State<'_, AppState>,
    path: String,
) -> Result<f64, String> {
    let mut engine = state.audio_engine.lock().unwrap();
    engine.load_track(&path)
}

#[cfg(feature = "gui")]
#[command]
pub async fn play(
    state: tauri::State<'_, AppState>,
    path: String,
) -> Result<(), String> {
    let mut engine = state.audio_engine.lock().unwrap();
    engine.play(&path)
}

#[cfg(feature = "gui")]
#[command]
pub async fn pause(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let engine = state.audio_engine.lock().unwrap();
    engine.pause();
    Ok(())
}

#[cfg(feature = "gui")]
#[command]
pub async fn stop(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut engine = state.audio_engine.lock().unwrap();
    engine.stop();
    Ok(())
}

#[cfg(feature = "gui")]
#[command]
pub async fn seek(
    state: tauri::State<'_, AppState>,
    seconds: f64,
) -> Result<(), String> {
    let engine = state.audio_engine.lock().unwrap();
    engine.seek(seconds);
    Ok(())
}

#[cfg(feature = "gui")]
#[command]
pub async fn set_volume(
    state: tauri::State<'_, AppState>,
    vol: u32,
) -> Result<(), String> {
    let engine = state.audio_engine.lock().unwrap();
    engine.set_volume(vol);
    Ok(())
}

#[cfg(feature = "gui")]
#[command]
pub async fn get_position(state: tauri::State<'_, AppState>) -> Result<f64, String> {
    let engine = state.audio_engine.lock().unwrap();
    Ok(engine.get_position())
}

#[cfg(feature = "gui")]
#[command]
pub async fn get_duration(state: tauri::State<'_, AppState>) -> Result<f64, String> {
    let engine = state.audio_engine.lock().unwrap();
    Ok(engine.get_duration())
}

#[cfg(feature = "gui")]
#[command]
pub async fn set_audio_mode(
    state: tauri::State<'_, AppState>,
    mode: String,
) -> Result<String, String> {
    let audio_mode = AudioMode::from_str(&mode)
        .ok_or_else(|| format!("Unknown audio mode: {}. Use 'normal' or 'asio'", mode))?;

    if audio_mode == AudioMode::Asio {
        #[cfg(not(feature = "asio"))]
        {
            return Err(
                "ASIO support not compiled. Rebuild with `asio` feature enabled.".to_string(),
            );
        }
    }

    let mut engine = state.audio_engine.lock().unwrap();
    engine.set_mode(audio_mode);
    Ok(format!("Audio mode set to: {}", audio_mode))
}

#[cfg(feature = "gui")]
#[command]
pub fn is_playing(state: tauri::State<'_, crate::AppState>) -> Result<bool, String> {
    let engine = state.audio_engine.lock().map_err(|e| e.to_string())?;
    Ok(engine.is_playing())
}

#[cfg(feature = "gui")]
#[command]
pub fn get_volume(state: tauri::State<'_, crate::AppState>) -> Result<u32, String> {
    let engine = state.audio_engine.lock().map_err(|e| e.to_string())?;
    Ok(engine.get_volume())
}

#[cfg(feature = "gui")]
#[command]
pub async fn get_audio_mode(state: tauri::State<'_, AppState>) -> Result<String, String> {
    let engine = state.audio_engine.lock().unwrap();
    Ok(engine.get_mode().to_string())
}

#[cfg(feature = "gui")]
#[command]
pub async fn list_audio_devices() -> Result<Vec<String>, String> {
    use cpal::traits::{DeviceTrait, HostTrait};
    let host = cpal::default_host();
    let devices = host.output_devices().map_err(|e| e.to_string())?;
    let names: Vec<String> = devices
        .filter_map(|d| d.description().ok().map(|desc| desc.name().to_string()))
        .collect();
    Ok(names)
}
