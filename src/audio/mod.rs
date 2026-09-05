pub mod decoder;
pub mod engine;
pub mod output;
pub mod resampler;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AudioMode {
    Wasapi,
    Asio,
}

impl std::fmt::Display for AudioMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AudioMode::Wasapi => write!(f, "normal"),
            AudioMode::Asio => write!(f, "asio"),
        }
    }
}

impl std::str::FromStr for AudioMode {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "normal" | "default" | "wasapi" => Ok(AudioMode::Wasapi),
            "asio" | "exclusive" => Ok(AudioMode::Asio),
            _ => Err(format!("Unknown audio mode: {}", s)),
        }
    }
}
