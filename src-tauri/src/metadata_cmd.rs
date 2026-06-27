use lofty::prelude::*;
use lofty::probe::Probe;
use serde::Serialize;
#[cfg(feature = "gui")]
use tauri::command;

#[derive(Serialize)]
pub struct MetadataResult {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub year: Option<u32>,
    pub genre: Option<String>,
    pub track: Option<u32>,
    pub duration: f64,
    pub bitrate: Option<u32>,
    pub sample_rate: Option<u32>,
    pub codec: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

fn fallback_metadata(path: &str, error: Option<String>) -> MetadataResult {
    MetadataResult {
        title: std::path::Path::new(path)
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string(),
        artist: "Unknown Artist".to_string(),
        album: "Unknown Album".to_string(),
        year: None,
        genre: None,
        track: None,
        duration: 0.0,
        bitrate: None,
        sample_rate: None,
        codec: "Unknown".to_string(),
        error,
    }
}

#[cfg(feature = "gui")]
#[command]
pub async fn read_metadata(path: String) -> Result<MetadataResult, String> {
    let tagged = match Probe::open(&path) {
        Ok(probe) => match probe.read() {
            Ok(t) => t,
            Err(e) => return Ok(fallback_metadata(&path, Some(e.to_string()))),
        },
        Err(e) => return Ok(fallback_metadata(&path, Some(e.to_string()))),
    };

    let tag = tagged.primary_tag().or_else(|| tagged.first_tag());
    let properties = tagged.properties();

    let (title, artist, album, year, genre, track) = if let Some(t) = tag {
        (
            t.title()
                .map(|s| s.to_string())
                .unwrap_or_else(|| {
                    std::path::Path::new(&path)
                        .file_stem()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .to_string()
                }),
            t.artist()
                .map(|s| s.to_string())
                .unwrap_or_else(|| "Unknown Artist".to_string()),
            t.album()
                .map(|s| s.to_string())
                .unwrap_or_else(|| "Unknown Album".to_string()),
            t.year(),
            t.genre().map(|s| s.to_string()),
            t.track(),
        )
    } else {
        let name = std::path::Path::new(&path)
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        (
            name,
            "Unknown Artist".to_string(),
            "Unknown Album".to_string(),
            None,
            None,
            None,
        )
    };

    Ok(MetadataResult {
        title,
        artist,
        album,
        year,
        genre,
        track,
        duration: properties.duration().as_secs_f64(),
        bitrate: properties.audio_bitrate(),
        sample_rate: properties.sample_rate(),
        codec: "Unknown".to_string(),
        error: None,
    })
}

/// Sync version for headless/server mode.
pub fn read_metadata_sync(path: &str) -> Result<MetadataResult, String> {
    let body = |path: &str| -> Result<MetadataResult, String> {
        let tagged = Probe::open(path)
            .map_err(|e| e.to_string())?
            .read()
            .map_err(|e| e.to_string())?;

        let tag = tagged.primary_tag().or_else(|| tagged.first_tag());
        let properties = tagged.properties();

        let (title, artist, album, year, genre, track) = if let Some(t) = tag {
            (
                t.title()
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| {
                        std::path::Path::new(path)
                            .file_stem()
                            .unwrap_or_default()
                            .to_string_lossy()
                            .to_string()
                    }),
                t.artist()
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| "Unknown Artist".to_string()),
                t.album()
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| "Unknown Album".to_string()),
                t.year(),
                t.genre().map(|s| s.to_string()),
                t.track(),
            )
        } else {
            return Ok(fallback_metadata(path, None));
        };

        Ok(MetadataResult {
            title,
            artist,
            album,
            year,
            genre,
            track,
            duration: properties.duration().as_secs_f64(),
            bitrate: properties.audio_bitrate(),
            sample_rate: properties.sample_rate(),
            codec: "Unknown".to_string(),
            error: None,
        })
    };

    match body(path) {
        Ok(r) => Ok(r),
        Err(e) => Ok(fallback_metadata(path, Some(e))),
    }
}
