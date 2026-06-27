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
    eprintln!("DEBUG: gui={} server={}", cfg!(feature = "gui"), cfg!(feature = "server"));
    let cli = Cli::parse();

    #[cfg(feature = "server")]
    let state = {
        let state = std::sync::Arc::new(std::sync::Mutex::new(
            musicli_lib::server_state::ServerState::new(),
        ));
        let port = musicli_lib::server::http::start_in_background(state.clone(), cli.port);
        std::env::set_var("MUSICLI_HTTP_PORT", port.to_string());
        state
    };

    #[cfg(not(feature = "server"))]
    let state: std::sync::Arc<std::sync::Mutex<musicli_lib::server_state::ServerState>> =
        std::sync::Arc::new(std::sync::Mutex::new(
            musicli_lib::server_state::ServerState::new(),
        ));

    #[cfg(feature = "gui")]
    if !cli.cli && !cli.server {
        return musicli_lib::run_gui();
    }

    if cli.server {
        #[cfg(feature = "server")]
        {
            println!("HTTP API: http://127.0.0.1:{}", {
                std::env::var("MUSICLI_HTTP_PORT").unwrap_or_default()
            });
            musicli_lib::server::repl::run_repl(state, None);
        }
        #[cfg(not(feature = "server"))]
        { eprintln!("Server mode needs --features server"); std::process::exit(1); }
    } else if cli.cli {
        #[cfg(feature = "server")]
        musicli_lib::server::repl::run_repl(state, None);
        #[cfg(not(feature = "server"))]
        { eprintln!("CLI mode needs --features server"); std::process::exit(1); }
    } else {
        #[cfg(feature = "server")]
        {
            // Server running in background, keep alive
            loop {
                std::thread::park();
            }
        }
        #[cfg(not(feature = "server"))]
        { /* GUI mode returns above, no else branch needed */ }
    }
}
