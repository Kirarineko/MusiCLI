#[cfg(feature = "gui")]
mod dialog_cmd;
#[cfg(feature = "gui")]
mod focus_cmd;
#[cfg(feature = "gui")]
mod lyrics_cmd;
#[cfg(feature = "gui")]
mod window_cmd;
#[cfg(feature = "gui")]
mod remote_cmd;
#[cfg(feature = "gui")]
mod transcode;
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
use tauri::Emitter;

#[cfg(feature = "gui")]
pub fn run_gui(state: Arc<Mutex<server_state::ServerState>>) {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(
                    |app: &tauri::AppHandle,
                     _shortcut: &tauri_plugin_global_shortcut::Shortcut,
                     event: tauri_plugin_global_shortcut::ShortcutEvent| {
                        use tauri_plugin_global_shortcut::ShortcutState;
                    if event.state() == ShortcutState::Pressed {
                        // Bring the main window forward, then ask the webview to
                        // focus the command input.
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                        // WebView2 refuses programmatic DOM focus right after
                        // activation — only a real (system-queued) click
                        // establishes keyboard focus. Send one into the window
                        // (any click focuses the input via the frontend's
                        // window-level click handler) after the activation
                        // settles, then re-emit focus-input as a fallback.
                        let app = app.clone();
                        let _ = std::thread::spawn(move || {
                            std::thread::sleep(std::time::Duration::from_millis(120));
                            #[cfg(target_os = "windows")]
                            if let Some(window) = app.get_webview_window("main") {
                                if let (Ok(pos), Ok(size)) =
                                    (window.outer_position(), window.outer_size())
                                {
                                    crate::focus_cmd::simulate_click(
                                        pos.x + size.width as i32 / 2,
                                        pos.y + size.height as i32 - 24,
                                    );
                                }
                            }
                            let _ = app.emit("focus-input", ());
                        });
                    }
                    },
                )
                .build(),
        )
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
            focus_cmd::set_focus_shortcut,
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
            commands::tags_get,
            commands::tags_set,
            commands::tags_all,
            commands::file_sha256,
            commands::create_zip,
            commands::extract_zip,
            commands::remote_start,
            commands::remote_stop,
            commands::remote_status,
            commands::set_music_folder,
            remote_cmd::remote_api_get,
            remote_cmd::remote_download,
            remote_cmd::llm_generate_tags,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
