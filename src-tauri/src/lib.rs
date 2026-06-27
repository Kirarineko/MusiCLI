mod dialog_cmd;
mod lyrics_cmd;
mod window_cmd;
pub mod audio;
pub mod core;
mod commands;
pub mod lrc_parser;
pub mod server;
pub mod server_state;

use std::sync::Mutex;
use tauri::Manager;
use audio::engine::AudioEngine;

pub struct AppState {
    pub audio_engine: Mutex<AudioEngine>,
}

pub fn run_gui() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            audio_engine: Mutex::new(AudioEngine::new()),
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                if window.label() == "main" {
                    if let Some(lyrics) = window.app_handle().get_webview_window("lyrics") {
                        let _ = lyrics.destroy();
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            dialog_cmd::open_files_dialog,
            dialog_cmd::open_image_dialog,
            dialog_cmd::open_folder_dialog,
            dialog_cmd::open_font_dialog,
            dialog_cmd::save_file_dialog,
            dialog_cmd::open_theme_dialog,
            dialog_cmd::save_dir_dialog,
            dialog_cmd::open_sync_dialog,
            lyrics_cmd::show_lyrics_window,
            lyrics_cmd::hide_lyrics_window,
            lyrics_cmd::send_lyrics_update,
            lyrics_cmd::send_lyrics_theme,
            lyrics_cmd::lyrics_auto_size,
            lyrics_cmd::lyrics_set_mouse_events,
            window_cmd::minimize_window,
            window_cmd::default_music_dir,
            audio::load_track,
            audio::play,
            audio::pause,
            audio::stop,
            audio::seek,
            audio::set_volume,
            audio::is_playing,
            audio::get_volume,
            audio::get_position,
            audio::get_duration,
            audio::set_audio_mode,
            audio::get_audio_mode,
            audio::list_audio_devices,
            commands::read_metadata,
            commands::list_audio_files,
            commands::read_file_base64,
            commands::dir_exists,
            commands::read_file,
            commands::write_file,
            commands::copy_file,
            commands::mkdir,
            commands::find_lrc,
            commands::read_lrc_offsets,
            commands::write_lrc_offset,
            commands::create_zip,
            commands::extract_zip,
            commands::remote_start,
            commands::remote_stop,
            commands::remote_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
