use lofty::prelude::*;
use lofty::probe::Probe;
use serde::Serialize;
use std::path::Path;

#[derive(Debug, Serialize)]
pub struct MetadataResult {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub year: Option<i32>,
    pub genre: Option<String>,
    pub track: Option<u32>,
    pub duration: Option<f64>,
    pub bitrate: Option<u32>,
    pub sample_rate: Option<u32>,
    pub codec: String,
}

fn extract_codec(path: &Path) -> String {
    let ext = path.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    match ext.as_str() {
        "mp3" => "MP3".into(),
        "flac" => "FLAC".into(),
        "wav" => "WAV".into(),
        "ogg" => "Vorbis".into(),
        "m4a" => "AAC/ALAC".into(),
        "wma" => "WMA".into(),
        _ => "Unknown".to_string(),
    }
}

pub fn read_metadata(path: &str) -> Result<MetadataResult, String> {
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
                    Path::new(path)
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
                .unwrap_or_default(),
            t.year().map(|y| y as i32),
            t.genre().map(|s| s.to_string()),
            t.track(),
        )
    } else {
        (
            Path::new(path)
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string(),
            "Unknown Artist".to_string(),
            String::new(),
            None,
            None,
            None,
        )
    };

    let codec = extract_codec(Path::new(path));

    Ok(MetadataResult {
        title,
        artist,
        album,
        year,
        genre,
        track,
        duration: Some(properties.duration().as_secs_f64()),
        bitrate: properties.audio_bitrate(),
        sample_rate: properties.sample_rate(),
        codec,
    })
}
