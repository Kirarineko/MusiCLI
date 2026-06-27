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

    #[cfg(feature = "gui")]
    if !cli.cli && !cli.server && cli.port == 0 {
        return musicli_lib::run_gui();
    }

    let port = if cli.port > 0 { cli.port } else { 3000 };
    let state = std::sync::Mutex::new(musicli_lib::server_state::ServerState::new());

    if cli.server || cli.port > 0 {
        #[cfg(feature = "server")]
        {
            let rt = tokio::runtime::Runtime::new().expect("tokio");
            let state = std::sync::Arc::new(state);
            let s2 = state.clone();
            rt.block_on(async move {
                let listener = tokio::net::TcpListener::bind(format!("127.0.0.1:{}", port)).await.expect("bind");
                println!("HTTP API: http://127.0.0.1:{}", port);
                axum::serve(listener, musicli_lib::server::http::build_router(s2)).await.expect("server");
            });
        }
        #[cfg(not(feature = "server"))]
        { eprintln!("Server mode needs --features server"); std::process::exit(1); }
    } else {
        #[cfg(feature = "server")]
        musicli_lib::server::repl::run_repl(std::sync::Arc::new(state), None);
        #[cfg(not(feature = "server"))]
        { eprintln!("CLI mode needs --features server"); std::process::exit(1); }
    }
}
