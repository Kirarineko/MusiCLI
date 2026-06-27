#[cfg(feature = "server")]
pub mod http;
#[cfg(feature = "server")]
pub mod repl;

use std::sync::{Arc, Mutex};
use crate::server_state::ServerState;

#[cfg(feature = "server")]
pub fn run_repl(state: Arc<Mutex<ServerState>>, url: Option<&str>) {
    repl::run_repl(state, url);
}
