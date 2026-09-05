use clap::Parser;

#[derive(Parser)]
#[command(name = "musicli", about = "Terminal music player & audio streaming server")]
struct Cli {
    #[arg(long, default_value_t = musicli_lib::server::http::START_PORT)]
    port: u16,
    #[arg(long, default_value = "0.0.0.0")]
    bind: String,
    /// Run as a background headless server without interactive REPL
    #[arg(long)]
    remote: bool,
    #[arg(long)]
    music_folder: Option<String>,
    /// Optional API token — when set, all HTTP requests must carry it
    /// (Authorization: Bearer <token> or ?token=<token>).
    #[arg(long)]
    token: Option<String>,
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
    state.lock().unwrap().api_token = cli.token.clone();

    let _ = musicli_lib::server_state::load_current_playlist(&state.lock().unwrap());

    // Load the Pocket Player password (persisted in {music_folder}/config/pocket.json).
    musicli_lib::server_state::load_pocket_config(&state.lock().unwrap());

    musicli_lib::server_state::init_global(state.clone());

    let port = musicli_lib::server::http::start_in_background(state.clone(), &cli.bind, cli.port);
    std::env::set_var("MUSICLI_HTTP_PORT", port.to_string());
    std::env::set_var("MUSICLI_HOST", cli.bind.as_str());

    if cli.token.as_deref().map(|t| !t.is_empty()).unwrap_or(false) {
        println!("API token required (--token) — clients must send Authorization: Bearer <token> or ?token=<token>");
    }

    if cli.remote {
        musicli_lib::server::repl::print_banner();
        println!("  「NekoCraft」 MusiCLI v{}  [Headless Remote Mode]", env!("CARGO_PKG_VERSION"));
        println!("  HTTP API listening on http://{}:{}", cli.bind, port);
        loop {
            std::thread::park();
        }
    } else {
        musicli_lib::server::repl::run_repl(state.clone());
    }
}

