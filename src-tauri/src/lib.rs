#[cfg(feature = "gui")]
mod dialog_cmd;
#[cfg(feature = "gui")]
mod lyrics_cmd;
#[cfg(feature = "gui")]
mod window_cmd;
pub mod audio;
pub mod core;
#[cfg(feature = "gui")]
mod commands;
pub mod lrc_parser;
pub mod server;
pub mod server_state;

#[cfg(feature = "gui")]
use std::sync::{Arc, Mutex};
#[cfg(feature = "gui")]
use tauri::Manager;

#[cfg(feature = "gui")]
pub fn run_gui(state: Arc<Mutex<server_state::ServerState>>) {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(state)
        .setup(|app| {
            // Inject the HTTP server port into the frontend so the hybrid
            // bridge can auto-discover and connect to the HTTP API.
            if let Ok(port_str) = std::env::var("MUSICLI_HTTP_PORT") {
                if let Ok(port) = port_str.parse::<u32>() {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.eval(format!(
                            "window.__MUSICLI_PORT__ = {};",
                            port
                        ));
                    }
                }
            }
            Ok(())
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
            commands::list_listen_webuis,
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
            commands::set_music_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
