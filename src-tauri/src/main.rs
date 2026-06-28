#![cfg_attr(not(target_os = "linux"), windows_subsystem = "windows")]

use clap::Parser;

#[derive(Parser)]
#[command(name = "musicli", about = "Pseudo-CLI local music player")]
struct Cli {
    #[arg(long, default_value_t = 0)]
    port: u16,
    #[arg(long)]
    remote: bool,
    #[arg(long)]
    music_folder: Option<String>,
}

fn main() {
    let cli = Cli::parse();

    let music_folder = musicli_lib::core::files::resolve_music_folder(
        cli.music_folder.as_deref()
    );

    let state = std::sync::Arc::new(std::sync::Mutex::new(
        musicli_lib::server_state::ServerState::new(),
    ));
    *state.lock().unwrap().music_folder.lock().unwrap() = music_folder;

    musicli_lib::server_state::init_global(state.clone());

    let port = musicli_lib::server::http::start_in_background(state.clone(), cli.port);
    std::env::set_var("MUSICLI_HTTP_PORT", port.to_string());

    #[cfg(feature = "gui")]
    if !cli.remote {
        return musicli_lib::run_gui();
    }

    println!("HTTP API: http://127.0.0.1:{}", port);
    loop {
        std::thread::park();
    }
}
