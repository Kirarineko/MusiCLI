use serde::{Deserialize, Serialize};
use tauri::{command, AppHandle, Emitter, Manager};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LyricsUpdateData {
    current: String,
    next: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LyricsThemeData {
    font: Option<String>,
    #[serde(rename = "fontSize")]
    font_size: Option<f64>,
    fg: Option<String>,
    #[serde(rename = "fgDim")]
    fg_dim: Option<String>,
    accent: Option<String>,
    bg: Option<String>,
    #[serde(rename = "lyricsAccent")]
    lyrics_accent: Option<String>,
    #[serde(rename = "lyricsFg")]
    lyrics_fg: Option<String>,
    #[serde(rename = "lyricsNextCount")]
    lyrics_next_count: Option<i32>,
    #[serde(rename = "lyricsGap")]
    lyrics_gap: Option<f64>,
    #[serde(rename = "lyricsShadow")]
    lyrics_shadow: Option<String>,
    #[serde(rename = "lyricsAlign")]
    lyrics_align: Option<String>,
    #[serde(rename = "lyricsCurrentSize")]
    lyrics_current_size: Option<f64>,
    #[serde(rename = "lyricsNextSize")]
    lyrics_next_size: Option<f64>,
    #[serde(rename = "lyricsVertical")]
    lyrics_vertical: Option<String>,
}

use std::sync::Mutex;

static LAST_LYRICS_THEME: Mutex<Option<LyricsThemeData>> = Mutex::new(None);

#[command]
pub async fn show_lyrics_window(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("lyrics") {
        w.show().map_err(|e| e.to_string())?;
        return Ok(());
    }

    let _window = tauri::WebviewWindowBuilder::new(
        &app,
        "lyrics",
        tauri::WebviewUrl::App("/#/lyrics".into()),
    )
    .title("Lyrics")
    .inner_size(600.0, 400.0)
    .min_inner_size(600.0, 80.0)
    .max_inner_size(600.0, 10000.0)
    .transparent(true)
    .decorations(false)
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(true)
    .build()
    .map_err(|e| e.to_string())?;

    // Replay last theme after window loads
    if let Ok(guard) = LAST_LYRICS_THEME.lock() {
        if let Some(ref theme) = *guard {
            if let Some(w) = app.get_webview_window("lyrics") {
                let _ = w.emit("lyrics:update-theme", theme.clone());
            }
        }
    }

    Ok(())
}

#[command]
pub async fn hide_lyrics_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("lyrics") {
        window.destroy().map_err(|e| e.to_string())?;
    }
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.emit(
            "lyrics:visibility-changed",
            serde_json::json!({"visible": false}),
        );
    }
    Ok(())
}

#[command]
pub async fn send_lyrics_update(app: AppHandle, data: LyricsUpdateData) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("lyrics") {
        window
            .emit("lyrics:update", data)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[command]
pub async fn send_lyrics_theme(app: AppHandle, data: LyricsThemeData) -> Result<(), String> {
    if let Ok(mut guard) = LAST_LYRICS_THEME.lock() {
        *guard = Some(data.clone());
    }
    if let Some(w) = app.get_webview_window("lyrics") {
        w.emit("lyrics:update-theme", data)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[command]
pub async fn lyrics_auto_size(app: AppHandle, _w: f64, h: f64) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("lyrics") {
        // Use LogicalSize so CSS pixels map 1:1 regardless of DPI scale.
        let new_h = ((h + 48.0).max(80.0)).round();
        window
            .set_size(tauri::Size::Logical(tauri::LogicalSize {
                width: 600.0,
                height: new_h,
            }))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[command]
pub async fn lyrics_set_mouse_events(app: AppHandle, enabled: bool) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("lyrics") {
        window
            .set_ignore_cursor_events(!enabled)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
