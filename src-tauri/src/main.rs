#![cfg_attr(not(feature = "gui"), windows_subsystem = "console")]

use clap::Parser;

#[derive(Parser)]
#[command(name = "musicli", about = "Pseudo-CLI local music player")]
struct Cli {
    #[arg(long)]
    cli: bool,
    #[arg(long, default_value_t = 0)]
    port: u16,
    #[arg(long)]
    server: bool,
}

fn main() {
    let cli = Cli::parse();

    let state = std::sync::Arc::new(std::sync::Mutex::new(
        musicli_lib::server_state::ServerState::new(),
    ));

    let port = musicli_lib::server::http::start_in_background(state.clone(), cli.port);
    std::env::set_var("MUSICLI_HTTP_PORT", port.to_string());

    #[cfg(feature = "gui")]
    if !cli.cli && !cli.server {
        return musicli_lib::run_gui();
    }

    if cli.server {
        println!("HTTP API: http://127.0.0.1:{}", port);
        // Server mode: block on REPL (or keep alive)
        #[cfg(feature = "server")]
        musicli_lib::server::repl::run_repl(state, None);
        #[cfg(not(feature = "server"))]
        { eprintln!("Server mode needs --features server"); std::process::exit(1); }
    } else if cli.cli {
        #[cfg(feature = "server")]
        musicli_lib::server::repl::run_repl(state, None);
        #[cfg(not(feature = "server"))]
        { eprintln!("CLI mode needs --features server"); std::process::exit(1); }
    } else {
        // Block forever when no mode selected (server running in background)
        loop {
            std::thread::park();
        }
    }
}
