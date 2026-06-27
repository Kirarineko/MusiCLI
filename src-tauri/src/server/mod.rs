pub mod http;
#[cfg(feature = "server")]
pub mod repl;

#[cfg(feature = "server")]
use std::sync::{Arc, Mutex};
#[cfg(feature = "server")]
use crate::server_state::ServerState;

#[cfg(feature = "server")]
pub fn run_repl(state: Arc<Mutex<ServerState>>, url: Option<&str>) {
    repl::run_repl(state, url);
}
