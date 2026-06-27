#[cfg(feature = "gui")]
mod dialog_cmd;
mod fs_cmd;
mod metadata_cmd;
mod config_cmd;
mod lrc_cmd;
mod zip_cmd;
#[cfg(feature = "gui")]
mod lyrics_cmd;
#[cfg(feature = "gui")]
mod window_cmd;
pub mod audio;
pub mod core;
pub mod lrc_parser;
#[cfg(feature = "server")]
pub mod server;
pub mod server_state;

#[cfg(feature = "gui")]
use std::sync::Mutex;
#[cfg(feature = "gui")]
use tauri::Manager;
#[cfg(feature = "gui")]
use audio::engine::AudioEngine;

#[cfg(feature = "gui")]
pub struct AppState {
    pub audio_engine: Mutex<AudioEngine>,
}

#[cfg(feature = "gui")]
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
            fs_cmd::read_file,
            fs_cmd::write_file,
            fs_cmd::read_file_base64,
            fs_cmd::list_audio_files,
            fs_cmd::dir_exists,
            fs_cmd::copy_file,
            fs_cmd::make_dir,
            metadata_cmd::read_metadata,
            config_cmd::read_config,
            config_cmd::write_config,
            lrc_cmd::find_lrc,
            lrc_cmd::read_lrc_offsets,
            lrc_cmd::write_lrc_offset,
            zip_cmd::create_zip,
            zip_cmd::extract_zip,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
