use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Playlist {
    pub name: String,
    pub desc: String,
    pub created_at: String,
    pub updated_at: Option<String>,
    pub sharer: Option<String>,
    pub tracks: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct PlaylistInfo {
    pub name: String,
    pub desc: String,
    pub created_at: String,
    pub track_count: usize,
}

#[derive(Debug, Serialize, Deserialize)]
struct PlaylistsFile {
    playlists: std::collections::HashMap<String, Playlist>,
    current: String,
}

fn playlists_path(music_folder: &str) -> std::path::PathBuf {
    Path::new(music_folder).join("config").join("playlists.json")
}

fn read_playlists_file(music_folder: &str) -> Result<PlaylistsFile, String> {
    let path = playlists_path(music_folder);
    if !path.exists() {
        let name = "Default";
        let default = PlaylistsFile {
            playlists: [(
                name.to_string(),
                Playlist {
                    name: name.to_string(),
                    desc: String::new(),
                    created_at: String::new(),
                    updated_at: None,
                    sharer: None,
                    tracks: vec![],
                },
            )]
            .into(),
            current: name.to_string(),
        };
        return Ok(default);
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

fn write_playlists_file(music_folder: &str, data: &PlaylistsFile) -> Result<(), String> {
    let path = playlists_path(music_folder);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

pub fn list_playlists(music_folder: &str) -> Result<Vec<PlaylistInfo>, String> {
    let data = read_playlists_file(music_folder)?;
    Ok(data.playlists.values().map(|p| PlaylistInfo {
        name: p.name.clone(),
        desc: p.desc.clone(),
        created_at: p.created_at.clone(),
        track_count: p.tracks.len(),
    }).collect())
}

pub fn get_playlist(music_folder: &str, name: &str) -> Result<Option<Playlist>, String> {
    let data = read_playlists_file(music_folder)?;
    Ok(data.playlists.get(name).cloned())
}

pub fn get_current_playlist_name(music_folder: &str) -> Result<String, String> {
    let data = read_playlists_file(music_folder)?;
    Ok(data.current)
}

pub fn create_playlist(music_folder: &str, name: &str, desc: Option<&str>, tracks: &[String]) -> Result<(), String> {
    let mut data = read_playlists_file(music_folder)?;
    if data.playlists.contains_key(name) {
        return Err("duplicate".into());
    }
    data.playlists.insert(name.to_string(), Playlist {
        name: name.to_string(),
        desc: desc.unwrap_or("").to_string(),
        created_at: chrono::Utc::now().to_rfc3339(),
        updated_at: None,
        sharer: None,
        tracks: tracks.to_vec(),
    });
    write_playlists_file(music_folder, &data)
}

pub fn delete_playlist(music_folder: &str, name: &str) -> Result<(), String> {
    let mut data = read_playlists_file(music_folder)?;
    if !data.playlists.contains_key(name) {
        return Err("not_found".into());
    }
    if data.playlists.len() <= 1 {
        return Err("last_one".into());
    }
    data.playlists.remove(name);
    if data.current == name {
        data.current = data.playlists.keys().next().unwrap().clone();
    }
    write_playlists_file(music_folder, &data)
}

pub fn switch_playlist(music_folder: &str, name: &str) -> Result<Option<Playlist>, String> {
    let mut data = read_playlists_file(music_folder)?;
    if !data.playlists.contains_key(name) {
        return Ok(None);
    }
    data.current = name.to_string();
    write_playlists_file(music_folder, &data)?;
    Ok(data.playlists.get(name).cloned())
}

pub fn add_tracks(music_folder: &str, playlist_name: &str, tracks: &[String]) -> Result<(), String> {
    let mut data = read_playlists_file(music_folder)?;
    let pl = data.playlists.get_mut(playlist_name)
        .ok_or("not_found")?;
    let existing: std::collections::HashSet<_> = pl.tracks.iter().cloned().collect();
    for t in tracks {
        if !existing.contains(t) {
            pl.tracks.push(t.clone());
        }
    }
    pl.updated_at = Some(chrono::Utc::now().to_rfc3339());
    write_playlists_file(music_folder, &data)
}

pub fn get_track_playlists(music_folder: &str, track: &str) -> Result<Vec<String>, String> {
    let data = read_playlists_file(music_folder)?;
    Ok(data.playlists.iter()
        .filter(|(_, p)| p.tracks.contains(&track.to_string()))
        .map(|(n, _)| n.clone())
        .collect())
}

pub fn sync_track_playlists(music_folder: &str, track: &str, playlist_names: &[String]) -> Result<(), String> {
    let mut data = read_playlists_file(music_folder)?;
    // Remove track from all playlists
    for pl in data.playlists.values_mut() {
        pl.tracks.retain(|t| t != track);
    }
    // Add to specified playlists
    let name_set: std::collections::HashSet<_> = playlist_names.iter().map(|s| s.as_str()).collect();
    for name in name_set {
        if let Some(pl) = data.playlists.get_mut(name) {
            if !pl.tracks.contains(&track.to_string()) {
                pl.tracks.push(track.to_string());
            }
        }
    }
    write_playlists_file(music_folder, &data)
}
