use std::io::{self, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use rustyline::error::ReadlineError;
use rustyline::{DefaultEditor, ExternalPrinter};

use crate::audio::AudioMode;
use crate::server_state::{NamedPlaylist, ServerState};

pub fn format_time(secs: f64) -> String {
    let secs = secs as u64;
    let h = secs / 3600;
    let m = (secs % 3600) / 60;
    let s = secs % 60;
    if h > 0 {
        format!("{}:{:02}:{:02}", h, m, s)
    } else {
        format!("{}:{:02}", m, s)
    }
}

fn term_width() -> usize {
    std::env::var("COLUMNS").ok().and_then(|s| s.parse().ok()).unwrap_or(80)
}

fn truncate_line(s: &str, max_w: usize) -> String {
    let mut w = 0;
    let mut result = String::new();
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\x1B' {
            result.push('\x1B');
            while let Some(&nc) = chars.peek() {
                result.push(nc);
                chars.next();
                if nc.is_alphabetic() {
                    break;
                }
            }
            continue;
        }
        let cw = if (c as u32) > 0x7F { 2 } else { 1 };
        if w + cw > max_w {
            break;
        }
        result.push(c);
        w += cw;
    }
    result
}

fn bar_str(pos: f64, dur: f64, w: u32, fill: char, empty: char) -> String {
    if dur <= 0.0 {
        return format!("[{}{}]", empty, empty.to_string().repeat(w.saturating_sub(1) as usize));
    }
    let ratio = (pos / dur).clamp(0.0, 1.0);
    let f = (ratio * w as f64).round() as usize;
    let r = w.saturating_sub(f as u32) as usize;
    if f == 0 {
        format!("[{}{}]", empty, empty.to_string().repeat(r.saturating_sub(1)))
    } else {
        format!("[{}{}{}]", fill.to_string().repeat(f.saturating_sub(1)), ">", empty.to_string().repeat(r))
    }
}

fn parse_range(input: &str, max: usize) -> Vec<usize> {
    let mut result = Vec::new();
    for part in input.split_whitespace() {
        let part = part.trim().trim_end_matches(',');
        if part.eq_ignore_ascii_case("all") {
            return (1..=max).collect();
        }
        if let Some((a, b)) = part.split_once('-') {
            let lo = a.trim().parse().unwrap_or(1);
            let hi = b.trim().parse().unwrap_or(max);
            for i in lo..=hi.min(max) {
                if i >= 1 {
                    result.push(i);
                }
            }
        } else if let Ok(n) = part.parse::<usize>() {
            if n >= 1 && n <= max {
                result.push(n);
            }
        }
    }
    result.sort();
    result.dedup();
    result
}

fn load_config(s: &mut ServerState) {
    let mf = s.music_folder.lock().unwrap().clone();
    if mf.is_empty() {
        return;
    }
    if let Ok(Some(v)) = crate::core::files::read_config(&mf, "settings") {
        if let Some(o) = v.as_object() {
            if let Some(x) = o.get("volume").and_then(|v| v.as_u64()) {
                s.audio_engine.lock().unwrap().set_volume(x as u32);
            }
            if let Some(x) = o.get("progressWidth").and_then(|v| v.as_u64()) {
                s.progress_width = x as u32;
            }
            if let Some(x) = o.get("progressFilled").and_then(|v| v.as_str()) {
                if let Some(c) = x.chars().next() {
                    s.progress_filled = c;
                }
            }
            if let Some(x) = o.get("progressEmpty").and_then(|v| v.as_str()) {
                if let Some(c) = x.chars().next() {
                    s.progress_empty = c;
                }
            }
            if let Some(x) = o.get("lyricsTerminal").and_then(|v| v.as_bool()) {
                *s.lrc_enabled.lock().unwrap() = x;
            }
            if let Some(x) = o.get("lyricsNextCount").and_then(|v| v.as_u64()) {
                *s.lrc_next_count.lock().unwrap() = x as usize;
            }
        }
    }
}

fn refresh_playlists_cache(s: &ServerState) {
    let mf = s.music_folder.lock().unwrap().clone();
    if mf.is_empty() {
        return;
    }
    if let Ok(infos) = crate::core::playlist::list_playlists(&mf) {
        let mut list = s.playlists.lock().unwrap();
        list.clear();
        for info in infos {
            let tracks = crate::core::playlist::get_playlist(&mf, &info.name)
                .ok()
                .flatten()
                .map(|p| p.tracks)
                .unwrap_or_default();
            list.push(NamedPlaylist {
                name: info.name,
                desc: info.desc,
                created_at: info.created_at,
                tracks,
            });
        }
    }
    if let Ok(cur) = crate::core::playlist::get_current_playlist_name(&mf) {
        *s.current_pl.lock().unwrap() = cur;
    }
}

fn load_playlists(s: &ServerState) {
    refresh_playlists_cache(s);
}

fn save_playlists(s: &ServerState) {
    let mf = s.music_folder.lock().unwrap().clone();
    if mf.is_empty() {
        return;
    }
    let pls = s.playlists.lock().unwrap();
    let cur = s.current_pl.lock().unwrap().clone();
    let data: serde_json::Map<String, serde_json::Value> = pls
        .iter()
        .map(|p| {
            (
                p.name.clone(),
                serde_json::json!({
                    "name": p.name,
                    "desc": p.desc,
                    "created_at": p.created_at,
                    "updated_at": null,
                    "sharer": null,
                    "tracks": p.tracks,
                }),
            )
        })
        .collect();
    let playlists_file = serde_json::json!({ "playlists": data, "current": cur });
    let path = std::path::Path::new(&mf).join("config").join("playlists.json");
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    let _ = std::fs::write(
        &path,
        serde_json::to_string_pretty(&playlists_file).unwrap_or_default(),
    );
}

fn sync_current_playlist(s: &ServerState) {
    let mf = s.music_folder.lock().unwrap().clone();
    let cur = s.current_pl.lock().unwrap().clone();
    if let Ok(Some(pl)) = crate::core::playlist::get_playlist(&mf, &cur) {
        let mut list = s.playlist.lock().unwrap();
        list.clear();
        list.extend(pl.tracks);
    }
}

fn load_lyrics(s: &ServerState, mp3_path: &str) {
    let mut lines = s.lrc_lines.lock().unwrap();
    lines.clear();
    *s.lrc_last_idx.lock().unwrap() = -1;
    *s.lrc_loaded_for.lock().unwrap() = mp3_path.to_string();
    let mf = s.music_folder.lock().unwrap().clone();
    let root = if !mf.is_empty() {
        mf.clone()
    } else {
        std::path::Path::new(mp3_path)
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| ".".to_string())
    };
    if let Ok(Some(lrc_path)) = crate::core::lyrics::find_lrc(mp3_path, &root) {
        if let Ok(content) = crate::core::files::read_file(&lrc_path) {
            let mut parsed = crate::lrc_parser::parse_lrc(&content);
            if !mf.is_empty() {
                let lrc_dir = std::path::Path::new(&mf).join("lrc");
                let lrc_dir_str = lrc_dir.to_string_lossy().to_string();
                if let Ok(offsets) = crate::core::lyrics::read_lrc_offsets(&lrc_dir_str) {
                    let track_name = std::path::Path::new(&lrc_path)
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("");
                    if let Some(&offset_ms) = offsets.get(track_name) {
                        let offset_secs = offset_ms as f64 / 1000.0;
                        for l in &mut parsed {
                            l.time += offset_secs;
                        }
                    }
                }
            }
            *lines = parsed;
        }
    }
}

fn save_settings(s: &ServerState) {
    let mf = s.music_folder.lock().unwrap().clone();
    if mf.is_empty() {
        return;
    }
    let mut obj = serde_json::Map::new();
    obj.insert(
        "volume".into(),
        serde_json::json!(s.audio_engine.lock().unwrap().get_volume()),
    );
    obj.insert("progressWidth".into(), serde_json::json!(s.progress_width));
    obj.insert(
        "progressFilled".into(),
        serde_json::json!(s.progress_filled.to_string()),
    );
    obj.insert(
        "progressEmpty".into(),
        serde_json::json!(s.progress_empty.to_string()),
    );
    obj.insert(
        "lyricsTerminal".into(),
        serde_json::json!(*s.lrc_enabled.lock().unwrap()),
    );
    obj.insert(
        "lyricsNextCount".into(),
        serde_json::json!(*s.lrc_next_count.lock().unwrap()),
    );
    obj.insert(
        "playMode".into(),
        serde_json::json!(s.play_mode.lock().unwrap().clone()),
    );
    let _ = crate::core::files::write_config(&mf, "settings", &serde_json::Value::Object(obj));
}

fn open_browser(url: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/c", "start", "", url])
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(url)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(url)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

fn localplay() {
    let port = std::env::var("MUSICLI_HTTP_PORT").unwrap_or_else(|_| "52013".to_string());
    let url = format!("http://127.0.0.1:{}/lp", port);
    match open_browser(&url) {
        Ok(()) => println!("  [LocalPlay] WebUI opened in browser: {}", url),
        Err(e) => println!("  [LocalPlay] Failed to open browser: {}. Please visit: {}", e, url),
    }
}

fn next_index(cur: usize, len: usize, mode: &str) -> Option<usize> {
    if len == 0 {
        return None;
    }
    match mode {
        "repeat-one" => Some(cur.min(len - 1)),
        "repeat-all" => Some((cur + 1) % len),
        "shuffle" => {
            if len == 1 {
                Some(0)
            } else {
                let mut seed = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_nanos() as u64)
                    .unwrap_or(0)
                    .wrapping_add(cur as u64);
                let mut cand = cur;
                for _ in 0..10 {
                    seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
                    cand = (seed as usize) % len;
                    if cand != cur {
                        break;
                    }
                }
                Some(cand)
            }
        }
        _ => {
            // "normal"
            if cur + 1 < len {
                Some(cur + 1)
            } else {
                None
            }
        }
    }
}

fn prev_index(cur: usize, len: usize, mode: &str) -> usize {
    if len == 0 {
        return 0;
    }
    if mode == "shuffle" {
        next_index(cur, len, mode).unwrap_or(0)
    } else if cur > 0 {
        cur - 1
    } else {
        len.saturating_sub(1)
    }
}

fn spawn_lyrics_worker<P: ExternalPrinter + Send + 'static>(
    state: Arc<Mutex<ServerState>>,
    running: Arc<AtomicBool>,
    mut printer: P,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let mut last_idx: i32 = -1;
        let mut last_track: String = String::new();
        let mut was_playing = false;

        while running.load(Ordering::Relaxed) {
            thread::sleep(Duration::from_millis(100));

            let (is_playing, pos, dur, cur_track, mode, lrc_enabled) = {
                let s = match state.lock() {
                    Ok(guard) => guard,
                    Err(_) => break,
                };
                let engine = s.audio_engine.lock().unwrap();
                let is_p = engine.is_playing();
                let p = engine.get_position();
                let d = engine.get_duration();
                let cur = s
                    .current_index
                    .lock()
                    .unwrap()
                    .and_then(|i| s.playlist.lock().unwrap().get(i).cloned())
                    .unwrap_or_default();
                let m = s.play_mode.lock().unwrap().clone();
                let en = *s.lrc_enabled.lock().unwrap();
                (is_p, p, d, cur, m, en)
            };

            // Detect track switch (either from user command or WebUI)
            if !cur_track.is_empty() && cur_track != last_track {
                last_track = cur_track.clone();
                last_idx = -1;
                if let Ok(s) = state.lock() {
                    if *s.lrc_loaded_for.lock().unwrap() != cur_track {
                        load_lyrics(&s, &cur_track);
                    }
                }
            }

            // Auto-advance when playback finishes naturally
            if was_playing && !is_playing && dur > 0.0 && pos >= (dur - 1.5).max(0.0) {
                if let Ok(s) = state.lock() {
                    let pl = s.playlist.lock().unwrap().clone();
                    if !pl.is_empty() {
                        let cur_i = s.current_index.lock().unwrap().unwrap_or(0);
                        if let Some(ni) = next_index(cur_i, pl.len(), &mode) {
                            let next_path = pl[ni].clone();
                            let mut engine = s.audio_engine.lock().unwrap();
                            if engine.play(&next_path).is_ok() {
                                *s.current_index.lock().unwrap() = Some(ni);
                                let name = std::path::Path::new(&next_path)
                                    .file_name()
                                    .map(|n| n.to_string_lossy().to_string())
                                    .unwrap_or_default();
                                let _ = printer.print(format!(
                                    "\n▶ {}  [{}]",
                                    name,
                                    format_time(engine.get_duration())
                                ));
                                load_lyrics(&s, &next_path);
                                last_track = next_path;
                                last_idx = -1;
                                was_playing = true;
                                continue;
                            }
                        }
                    }
                }
            }
            was_playing = is_playing;

            // Terminal lyric printing
            if !is_playing || !lrc_enabled {
                continue;
            }

            let lines = {
                if let Ok(s) = state.lock() {
                    s.lrc_lines.lock().unwrap().clone()
                } else {
                    Vec::new()
                }
            };

            if lines.is_empty() {
                continue;
            }

            let new_idx = crate::lrc_parser::get_current_line_idx(&lines, pos);
            if new_idx == last_idx {
                continue;
            }

            let tw = term_width().saturating_sub(4);

            if new_idx > last_idx {
                if new_idx - last_idx > 10 {
                    // Large forward jump (seek or start midway)
                    if new_idx >= 0 && (new_idx as usize) < lines.len() {
                        let text = lines[new_idx as usize].text.trim();
                        if !text.is_empty() {
                            let disp = truncate_line(text, tw);
                            let _ = printer.print(format!("  \x1B[36m{}\x1B[0m", disp));
                        }
                    }
                } else {
                    // Sequential advance: print each non-empty line
                    let start = (last_idx + 1).max(0) as usize;
                    let end = (new_idx as usize).min(lines.len().saturating_sub(1));
                    for line in &lines[start..=end] {
                        let text = line.text.trim();
                        if !text.is_empty() {
                            let disp = truncate_line(text, tw);
                            let _ = printer.print(format!("  \x1B[36m{}\x1B[0m", disp));
                        }
                    }
                }
            } else {
                // Backward seek
                if new_idx >= 0 && (new_idx as usize) < lines.len() {
                    let text = lines[new_idx as usize].text.trim();
                    if !text.is_empty() {
                        let disp = truncate_line(text, tw);
                        let _ = printer.print(format!("  \x1B[36m{}\x1B[0m", disp));
                    }
                }
            }
            last_idx = new_idx;
            if let Ok(s) = state.lock() {
                *s.lrc_last_idx.lock().unwrap() = new_idx;
            }
        }
    })
}

const BANNER_MUSICLI: &str = r#"███╗   ███╗██╗   ██╗███████╗██╗ ██████╗██╗     ██╗
████╗ ████║██║   ██║██╔════╝██║██╔════╝██║     ██║
██╔████╔██║██║   ██║███████╗██║██║     ██║     ██║
██║╚██╔╝██║██║   ██║╚════██║██║██║     ██║     ██║
██║ ╚═╝ ██║╚██████╔╝███████║██║╚██████╗███████╗██║
╚═╝     ╚═╝ ╚═════╝ ╚══════╝╚═╝ ╚═════╝╚══════╝╚═╝"#;
pub fn print_banner() {
    println!();
    for line in BANNER_MUSICLI.lines() {
        println!("  \x1B[36m{}\x1B[0m", line);
    }
    println!();
}

pub fn run_repl(state: Arc<Mutex<ServerState>>) {
    let mut rl = match DefaultEditor::new() {
        Ok(e) => e,
        Err(err) => {
            eprintln!("Failed to initialize terminal REPL: {}", err);
            loop {
                std::thread::park();
            }
        }
    };
    let history_path = dirs::cache_dir()
        .map(|d| d.join("musicli_history"))
        .unwrap_or_else(|| std::path::PathBuf::from(".musicli_history"));
    let _ = rl.load_history(&history_path);

    let port = std::env::var("MUSICLI_HTTP_PORT").unwrap_or_else(|_| "52013".to_string());
    let host = std::env::var("MUSICLI_HOST").unwrap_or_else(|_| "0.0.0.0".to_string());

    print_banner();
    println!("  「NekoCraft」 MusiCLI v{}", env!("CARGO_PKG_VERSION"));
    println!("  HTTP API listening on http://{}:{}", host, port);
    println!("  Type 'help' for commands, 'lp' / 'listen' / 'pocket' for WebUIs, 'quit' to exit.");
    println!();

    {
        let mut s = state.lock().unwrap();
        if s.music_folder.lock().unwrap().is_empty() {
            let dir = dirs::audio_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
            *s.music_folder.lock().unwrap() = dir.to_string_lossy().to_string();
        }
        load_config(&mut s);
        load_playlists(&s);
        sync_current_playlist(&s);
    }

    let running = Arc::new(AtomicBool::new(true));
    let worker_handle = match rl.create_external_printer() {
        Ok(printer) => Some(spawn_lyrics_worker(state.clone(), running.clone(), printer)),
        Err(e) => {
            eprintln!("Warning: Failed to create external printer: {}", e);
            None
        }
    };

    loop {
        let prompt = {
            let s = state.lock().unwrap();
            let engine = s.audio_engine.lock().unwrap();
            let mode = match s.play_mode.lock().unwrap().as_str() {
                "repeat-one" => "[1]",
                "repeat-all" => "[A]",
                "shuffle" => "[S]",
                _ => "",
            };
            if engine.is_playing() && !mode.is_empty() {
                format!(">{mode} ")
            } else {
                "> ".to_string()
            }
        };
        match rl.readline(&prompt) {
            Ok(line) => {
                let line = line.trim().to_string();
                if line.is_empty() {
                    continue;
                }
                let _ = rl.add_history_entry(&line);
                if exec(&state, &line) {
                    break;
                }
            }
            Err(ReadlineError::Interrupted) | Err(ReadlineError::Eof) => {
                println!("quit");
                break;
            }
            Err(e) => {
                eprintln!("Error: {}", e);
                break;
            }
        }
    }
    running.store(false, Ordering::Relaxed);
    if let Some(h) = worker_handle {
        h.join().ok();
    }
    let _ = rl.save_history(&history_path);
}

fn exec(state: &Arc<Mutex<ServerState>>, raw: &str) -> bool {
    let parts: Vec<&str> = raw.split_whitespace().collect();
    if parts.is_empty() {
        return false;
    }
    let cmd = parts[0].to_lowercase();
    let args: &[&str] = &parts[1..];
    match cmd.as_str() {
        "quit" | "exit" | "q" => {
            if let Ok(s) = state.lock() {
                s.audio_engine.lock().unwrap().stop();
            }
            println!("Goodbye.");
            true
        }
        "help" | "?" | "h" => {
            print_help();
            false
        }
        "lp" | "localplay" => {
            localplay();
            false
        }
        "listen" => {
            listen_cmd(state, args);
            false
        }
        "pocket" => {
            pocket_cmd(state, args);
            false
        }
        "status" => {
            print_status(state);
            false
        }
        "play" | "resume" => {
            play(state, args);
            false
        }
        "pause" | "paus" => {
            state.lock().unwrap().audio_engine.lock().unwrap().pause();
            println!("Paused.");
            false
        }
        "stop" => {
            state.lock().unwrap().audio_engine.lock().unwrap().stop();
            println!("Stopped.");
            false
        }
        "next" | "n" | "skip" => {
            nxt(state);
            false
        }
        "prev" | "p" | "back" | "previous" => {
            prv(state);
            false
        }
        "seek" | "goto" => {
            seek(state, args);
            false
        }
        "vol" | "volume" => {
            vol(state, args);
            false
        }
        "list" | "ls" => {
            list(state, args);
            false
        }
        "open" | "load" | "folder" => {
            open(state, args);
            false
        }
        "audio" | "aud" => {
            audio(state, args);
            false
        }
        "devices" => {
            devices();
            false
        }
        "info" | "meta" | "metadata" => {
            info(state);
            false
        }
        "clear" | "cls" => {
            print!("\x1B[2J\x1B[1;1H");
            let _ = io::stdout().flush();
            false
        }
        "bar" => {
            bar(state, args);
            false
        }
        "mode" | "loop" | "repeat" => {
            mode(state, args);
            false
        }
        "pl" => {
            pl(state, args);
            false
        }
        "cd" => {
            cd(state, args);
            false
        }
        "import" => {
            import(state);
            false
        }
        "t" | "track" => {
            track(state, args);
            false
        }
        "lyric" | "lyrics" | "lrc" => {
            lyric_cmd(state, args);
            false
        }
        _ => {
            println!("Unknown: '{}'. Type 'help'.", cmd);
            false
        }
    }
}

fn lyric_cmd(state: &Arc<Mutex<ServerState>>, args: &[&str]) {
    let s = state.lock().unwrap();
    let sub = args.first().copied().unwrap_or("").to_lowercase();
    match sub.as_str() {
        "on" | "enable" | "t" | "terminal" => {
            *s.lrc_enabled.lock().unwrap() = true;
            save_settings(&s);
            println!("Terminal lyrics: ON");
        }
        "off" | "disable" => {
            *s.lrc_enabled.lock().unwrap() = false;
            save_settings(&s);
            println!("Terminal lyrics: OFF");
        }
        "status" => {
            let on = *s.lrc_enabled.lock().unwrap();
            println!("Terminal lyrics: {}", if on { "ON" } else { "OFF" });
        }
        _ => {
            let mut en = s.lrc_enabled.lock().unwrap();
            *en = !*en;
            let current = *en;
            drop(en);
            save_settings(&s);
            println!("Terminal lyrics: {}", if current { "ON" } else { "OFF" });
        }
    }
}

fn print_status(state: &Arc<Mutex<ServerState>>) {
    let port = std::env::var("MUSICLI_HTTP_PORT").unwrap_or_else(|_| "52013".to_string());
    let host = std::env::var("MUSICLI_HOST").unwrap_or_else(|_| "0.0.0.0".to_string());
    let s = state.lock().unwrap();
    let engine = s.audio_engine.lock().unwrap();
    let cur_track = s
        .current_index
        .lock()
        .unwrap()
        .and_then(|i| s.playlist.lock().unwrap().get(i).cloned())
        .unwrap_or_else(|| "(None)".to_string());
    let pl_name = s.current_pl.lock().unwrap().clone();
    let pl_len = s.playlist.lock().unwrap().len();

    println!();
    println!("  HTTP API:     http://{}:{}", host, port);
    println!("  WebUI (LP):   http://127.0.0.1:{}/lp", port);
    println!("  WebUI (Sync): http://127.0.0.1:{}/listen", port);
    println!("  Pocket (PWA): http://127.0.0.1:{}/pocket", port);
    println!("  Playing:      {}", if engine.is_playing() { "Yes" } else { "No" });
    println!("  Track:        {}", cur_track);
    println!("  Playlist:     {} ({} tracks)", pl_name, pl_len);
    println!("  Position:     {}/{}", format_time(engine.get_position()), format_time(engine.get_duration()));
    println!("  Volume:       {}", engine.get_volume());
    println!("  Lyrics:       {}", if *s.lrc_enabled.lock().unwrap() { "ON" } else { "OFF" });
    println!();
}

pub fn get_local_ip() -> Option<String> {
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    let addr = socket.local_addr().ok()?;
    let ip = addr.ip().to_string();
    if ip == "0.0.0.0" || ip == "127.0.0.1" {
        None
    } else {
        Some(ip)
    }
}

pub fn match_skin_choice(input: &str, files: &[String]) -> Option<String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Ok(idx) = trimmed.parse::<usize>() {
        if idx >= 1 && idx <= files.len() {
            return Some(files[idx - 1].clone());
        }
    }
    let lower = trimmed.to_lowercase();
    if let Some(f) = files.iter().find(|f| f.eq_ignore_ascii_case(&lower)) {
        return Some(f.clone());
    }
    if let Some(f) = files.iter().find(|f| {
        let stem = std::path::Path::new(f.as_str())
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("");
        stem.eq_ignore_ascii_case(&lower)
    }) {
        return Some(f.clone());
    }
    if let Some(f) = files.iter().find(|f| f.to_lowercase().contains(&lower)) {
        return Some(f.clone());
    }
    None
}

fn listen_cmd(state: &Arc<Mutex<ServerState>>, args: &[&str]) {
    let port = std::env::var("MUSICLI_HTTP_PORT").unwrap_or_else(|_| "52013".to_string());
    let host = std::env::var("MUSICLI_HOST").unwrap_or_else(|_| "0.0.0.0".to_string());
    let sub = args.first().copied().unwrap_or("");
    let rest = args.get(1..).unwrap_or(&[]);

    match sub {
        "open" => {
            let url = format!("http://127.0.0.1:{}/listen", port);
            match open_browser(&url) {
                Ok(()) => println!("  [Listen] WebUI opened in browser: {}", url),
                Err(e) => println!("  [Listen] Failed to open browser: {}. Please visit: {}", e, url),
            }
        }
        "ui" | "skin" => {
            let mf = state.lock().unwrap().music_folder.lock().unwrap().clone();
            if mf.is_empty() {
                println!("No music folder configured. Use 'open <dir>' first.");
                return;
            }

            let webui_dir = std::path::Path::new(&mf).join("Listen_WebUI");
            let _ = std::fs::create_dir_all(&webui_dir);
            let dir_str = webui_dir.to_string_lossy().to_string();
            let files = crate::core::files::list_html_files(&dir_str).unwrap_or_default();
            let cur_ui = crate::server_state::read_listen_webui(&mf);

            if rest.is_empty() {
                println!();
                println!("  Listen WebUI Skins (in {}):", dir_str);
                let is_default_active = cur_ui.is_none();
                println!(
                    "    0. [Built-in Default]{}",
                    if is_default_active { "  ◀ (active)" } else { "" }
                );
                for (i, f) in files.iter().enumerate() {
                    let is_active = cur_ui.as_deref() == Some(f.as_str());
                    println!(
                        "    {}. {}{}",
                        i + 1,
                        f,
                        if is_active { "  ◀ (active)" } else { "" }
                    );
                }
                if files.is_empty() {
                    println!("    (No custom skins found. Drop .html files here to customize)");
                }
                println!();
                print!("Select skin (0-{}, name, or Enter to cancel): ", files.len());
                let _ = io::stdout().flush();
                let mut in_ = String::new();
                if io::stdin().read_line(&mut in_).is_ok() {
                    let choice = in_.trim();
                    if choice.is_empty() {
                        return;
                    }
                    if choice == "0" || choice.eq_ignore_ascii_case("default") || choice.eq_ignore_ascii_case("reset") {
                        let s = state.lock().unwrap();
                        let _ = crate::server_state::set_listen_webui_on_state(&s, None);
                        println!("Reset Listen WebUI to built-in default.");
                    } else if let Some(target) = match_skin_choice(choice, &files) {
                        let s = state.lock().unwrap();
                        let _ = crate::server_state::set_listen_webui_on_state(&s, Some(target.clone()));
                        println!("Switched Listen WebUI to: {}", target);
                    } else {
                        println!("Invalid selection.");
                    }
                }
            } else {
                let target_arg = rest.join(" ");
                if target_arg == "0" || target_arg.eq_ignore_ascii_case("default") || target_arg.eq_ignore_ascii_case("reset") {
                    let s = state.lock().unwrap();
                    let _ = crate::server_state::set_listen_webui_on_state(&s, None);
                    println!("Reset Listen WebUI to built-in default.");
                } else if let Some(target) = match_skin_choice(&target_arg, &files) {
                    let s = state.lock().unwrap();
                    let _ = crate::server_state::set_listen_webui_on_state(&s, Some(target.clone()));
                    println!("Switched Listen WebUI to: {}", target);
                } else {
                    println!("Skin '{}' not found. Use 'listen ui' to list available skins.", target_arg);
                }
            }
        }
        _ => {
            let mf = state.lock().unwrap().music_folder.lock().unwrap().clone();
            let cur_ui = crate::server_state::read_listen_webui(&mf)
                .unwrap_or_else(|| "Built-in Default".to_string());
            let local_ip = get_local_ip();

            println!();
            println!("  Listen WebUI (Real-time Stream & Remote Control):");
            println!("    Port:       {}", port);
            println!("    Local URL:  http://127.0.0.1:{}/listen", port);
            if host == "0.0.0.0" {
                if let Some(ip) = local_ip {
                    println!("    LAN URL:    http://{}:{}/listen", ip, port);
                } else {
                    println!("    LAN URL:    http://<server-ip>:{}/listen", port);
                }
            } else if host != "127.0.0.1" {
                println!("    Host URL:   http://{}:{}/listen", host, port);
            }
            println!("    Active UI:  {}", cur_ui);
            if !mf.is_empty() {
                let webui_dir = std::path::Path::new(&mf).join("Listen_WebUI");
                println!("    Folder:     {}", webui_dir.to_string_lossy());
            }
            println!();
            println!("  Usage:");
            println!("    listen open          - Open Listen WebUI in default browser");
            println!("    listen ui            - List and switch Listen WebUI skins");
            println!("    listen ui <name|n>   - Switch to skin by name or number");
            println!("    listen ui default    - Reset to built-in default skin");
            println!();
        }
    }
}

fn pocket_cmd(state: &Arc<Mutex<ServerState>>, args: &[&str]) {
    let port = std::env::var("MUSICLI_HTTP_PORT").unwrap_or_else(|_| "52013".to_string());
    let host = std::env::var("MUSICLI_HOST").unwrap_or_else(|_| "0.0.0.0".to_string());
    let sub = args.first().copied().unwrap_or("");
    let rest = args.get(1..).unwrap_or(&[]);

    match sub {
        "open" => {
            let url = format!("http://127.0.0.1:{}/pocket", port);
            match open_browser(&url) {
                Ok(()) => println!("  [Pocket] WebUI opened in browser: {}", url),
                Err(e) => println!("  [Pocket] Failed to open browser: {}. Please visit: {}", e, url),
            }
        }
        "pw" | "password" => {
            if rest.is_empty() {
                let s = state.lock().unwrap();
                let has_pw = s.pocket_password.lock().unwrap().is_some();
                println!("Pocket password protection: {}", if has_pw { "Enabled" } else { "Disabled" });
                println!("Usage: pocket pw <password> | pocket pw off");
            } else {
                let val = rest.join(" ");
                let s = state.lock().unwrap();
                if val.eq_ignore_ascii_case("off") || val.eq_ignore_ascii_case("clear") || val.eq_ignore_ascii_case("none") {
                    let _ = crate::server_state::set_pocket_password_on_state(&s, None);
                    println!("Pocket password protection disabled.");
                } else {
                    match crate::server_state::set_pocket_password_on_state(&s, Some(val)) {
                        Ok(()) => println!("Pocket password updated successfully."),
                        Err(e) => println!("Error setting pocket password: {}", e),
                    }
                }
            }
        }
        "ui" | "skin" => {
            let mf = state.lock().unwrap().music_folder.lock().unwrap().clone();
            if mf.is_empty() {
                println!("No music folder configured. Use 'open <dir>' first.");
                return;
            }

            let pocket_dir = std::path::Path::new(&mf).join("Listen_WebUI").join("Pocket");
            let _ = std::fs::create_dir_all(&pocket_dir);
            let dir_str = pocket_dir.to_string_lossy().to_string();
            let files = crate::core::files::list_html_files(&dir_str).unwrap_or_default();
            let cur_ui = crate::server_state::read_pocket_webui(&mf);

            if rest.is_empty() {
                println!();
                println!("  Pocket WebUI Skins (in {}):", dir_str);
                let is_default_active = cur_ui.is_none();
                println!(
                    "    0. [Built-in Default PWA]{}",
                    if is_default_active { "  ◀ (active)" } else { "" }
                );
                for (i, f) in files.iter().enumerate() {
                    let is_active = cur_ui.as_deref() == Some(f.as_str());
                    println!(
                        "    {}. {}{}",
                        i + 1,
                        f,
                        if is_active { "  ◀ (active)" } else { "" }
                    );
                }
                if files.is_empty() {
                    println!("    (No custom Pocket skins found. Drop .html files here to customize)");
                }
                println!();
                print!("Select skin (0-{}, name, or Enter to cancel): ", files.len());
                let _ = io::stdout().flush();
                let mut in_ = String::new();
                if io::stdin().read_line(&mut in_).is_ok() {
                    let choice = in_.trim();
                    if choice.is_empty() {
                        return;
                    }
                    if choice == "0" || choice.eq_ignore_ascii_case("default") || choice.eq_ignore_ascii_case("reset") {
                        let s = state.lock().unwrap();
                        let _ = crate::server_state::set_pocket_webui_on_state(&s, None);
                        println!("Reset Pocket WebUI to built-in default PWA.");
                    } else if let Some(target) = match_skin_choice(choice, &files) {
                        let s = state.lock().unwrap();
                        let _ = crate::server_state::set_pocket_webui_on_state(&s, Some(target.clone()));
                        println!("Switched Pocket WebUI to: {}", target);
                    } else {
                        println!("Invalid selection.");
                    }
                }
            } else {
                let target_arg = rest.join(" ");
                if target_arg == "0" || target_arg.eq_ignore_ascii_case("default") || target_arg.eq_ignore_ascii_case("reset") {
                    let s = state.lock().unwrap();
                    let _ = crate::server_state::set_pocket_webui_on_state(&s, None);
                    println!("Reset Pocket WebUI to built-in default PWA.");
                } else if let Some(target) = match_skin_choice(&target_arg, &files) {
                    let s = state.lock().unwrap();
                    let _ = crate::server_state::set_pocket_webui_on_state(&s, Some(target.clone()));
                    println!("Switched Pocket WebUI to: {}", target);
                } else {
                    println!("Skin '{}' not found. Use 'pocket ui' to list available skins.", target_arg);
                }
            }
        }
        _ => {
            let (mf, has_pw) = {
                let s = state.lock().unwrap();
                let mf = s.music_folder.lock().unwrap().clone();
                let has_pw = s.pocket_password.lock().unwrap().is_some();
                (mf, has_pw)
            };
            let cur_ui = crate::server_state::read_pocket_webui(&mf)
                .unwrap_or_else(|| "Built-in Default PWA".to_string());
            let local_ip = get_local_ip();

            println!();
            println!("  Pocket Player (Mobile PWA):");
            println!("    Port:       {}", port);
            println!("    Local URL:  http://127.0.0.1:{}/pocket", port);
            if host == "0.0.0.0" {
                if let Some(ip) = local_ip {
                    println!("    LAN URL:    http://{}:{}/pocket", ip, port);
                } else {
                    println!("    LAN URL:    http://<server-ip>:{}/pocket", port);
                }
            } else if host != "127.0.0.1" {
                println!("    Host URL:   http://{}:{}/pocket", host, port);
            }
            println!("    Password:   {}", if has_pw { "Enabled" } else { "Disabled" });
            println!("    Active UI:  {}", cur_ui);
            if !mf.is_empty() {
                let pocket_dir = std::path::Path::new(&mf).join("Listen_WebUI").join("Pocket");
                println!("    Folder:     {}", pocket_dir.to_string_lossy());
            }
            println!();
            println!("  Usage:");
            println!("    pocket open          - Open Pocket WebUI in default browser");
            println!("    pocket ui            - List and switch Pocket WebUI skins");
            println!("    pocket ui <name|n>   - Switch to skin by name or number");
            println!("    pocket ui default    - Reset to built-in default PWA");
            println!("    pocket pw <password> - Set access password");
            println!("    pocket pw off        - Disable access password");
            println!();
        }
    }
}

fn play(state: &Arc<Mutex<ServerState>>, args: &[&str]) {
    let s = state.lock().unwrap();
    if args.is_empty() {
        let engine = s.audio_engine.lock().unwrap();
        if engine.is_paused() {
            if let Err(e) = engine.resume() {
                println!("Error resuming: {}", e);
            } else {
                println!("Resumed.");
            }
            return;
        }
    }
    let pl = s.playlist.lock().unwrap().clone();
    if pl.is_empty() {
        println!("No tracks loaded. Use 'open <dir>' or 'import'.");
        return;
    }
    let idx = if args.is_empty() {
        s.current_index.lock().unwrap().unwrap_or(0)
    } else if let Ok(n) = args[0].parse::<usize>() {
        if n < 1 || n > pl.len() {
            println!("Index out of range: 1-{}", pl.len());
            return;
        }
        n - 1
    } else {
        let q = args.join(" ").to_lowercase();
        let m: Vec<usize> = pl
            .iter()
            .enumerate()
            .filter(|(_, p)| {
                std::path::Path::new(p)
                    .file_name()
                    .map(|n| n.to_string_lossy().to_lowercase())
                    .unwrap_or_default()
                    .contains(&q)
            })
            .map(|(i, _)| i)
            .collect();
        if m.is_empty() {
            println!("No match found for '{}'", q);
            return;
        }
        if m.len() == 1 {
            m[0]
        } else {
            for (i, &mi) in m.iter().enumerate() {
                println!(
                    "  {}. {}",
                    i + 1,
                    std::path::Path::new(&pl[mi])
                        .file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_default()
                );
            }
            print!("Select (1-{}): ", m.len());
            let _ = io::stdout().flush();
            let mut in_ = String::new();
            io::stdin().read_line(&mut in_).ok();
            let p = in_.trim().parse::<usize>().unwrap_or(0);
            if p < 1 || p > m.len() {
                return;
            }
            m[p - 1]
        }
    };
    let path = pl[idx].clone();
    drop(s);
    play_track(state, &path, idx);
}

fn play_track(state: &Arc<Mutex<ServerState>>, path: &str, idx: usize) {
    let s = state.lock().unwrap();
    let mut engine = s.audio_engine.lock().unwrap();
    match engine.play(path) {
        Ok(()) => {
            *s.current_index.lock().unwrap() = Some(idx);
            let name = std::path::Path::new(path)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            println!("\n▶ {}  [{}]", name, format_time(engine.get_duration()));
            load_lyrics(&s, path);
        }
        Err(e) => println!("Error playing track: {}", e),
    }
}

fn nxt(state: &Arc<Mutex<ServerState>>) {
    let s = state.lock().unwrap();
    let pl = s.playlist.lock().unwrap().clone();
    if pl.is_empty() {
        println!("No tracks in playlist.");
        return;
    }
    let cur = s.current_index.lock().unwrap().unwrap_or(0);
    let mode = s.play_mode.lock().unwrap().clone();
    let idx = next_index(cur, pl.len(), &mode).unwrap_or(0);
    let path = pl[idx].clone();
    drop(s);
    play_track(state, &path, idx);
}

fn prv(state: &Arc<Mutex<ServerState>>) {
    let s = state.lock().unwrap();
    let pl = s.playlist.lock().unwrap().clone();
    if pl.is_empty() {
        println!("No tracks in playlist.");
        return;
    }
    let cur = s.current_index.lock().unwrap().unwrap_or(0);
    let mode = s.play_mode.lock().unwrap().clone();
    let idx = prev_index(cur, pl.len(), &mode);
    let path = pl[idx].clone();
    drop(s);
    play_track(state, &path, idx);
}

fn seek(state: &Arc<Mutex<ServerState>>, args: &[&str]) {
    if let Some(a) = args.first().and_then(|a| a.parse::<f64>().ok()) {
        state.lock().unwrap().audio_engine.lock().unwrap().seek(a);
        println!("Seek to: {}", format_time(a));
    } else {
        println!("Usage: seek <seconds>");
    }
}

fn vol(state: &Arc<Mutex<ServerState>>, args: &[&str]) {
    let s = state.lock().unwrap();
    if let Some(v) = args.first().and_then(|a| a.parse::<u32>().ok()) {
        s.audio_engine.lock().unwrap().set_volume(v.min(100));
        println!("Volume: {}", v.min(100));
        save_settings(&s);
    } else {
        println!("Volume: {}", s.audio_engine.lock().unwrap().get_volume());
    }
}

fn list(state: &Arc<Mutex<ServerState>>, args: &[&str]) {
    let s = state.lock().unwrap();
    let pl = s.playlist.lock().unwrap();
    if pl.is_empty() {
        println!("Playlist is empty.");
        return;
    }
    let page = args.first().and_then(|a| a.parse::<usize>().ok()).unwrap_or(1).max(1);
    let ps = 20;
    let start = (page - 1) * ps;
    let end = (start + ps).min(pl.len());
    println!("Tracks {}-{} / {}  (page {})", start + 1, end, pl.len(), page);
    let cur = *s.current_index.lock().unwrap();
    for i in start..end {
        let n = std::path::Path::new(&pl[i])
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        println!("{} {}. {}", if Some(i) == cur { "▶" } else { " " }, i + 1, n);
    }
}

fn open(state: &Arc<Mutex<ServerState>>, args: &[&str]) {
    if args.first() == Some(&"dir") || args.is_empty() {
        print!("Music directory: ");
        let _ = io::stdout().flush();
        let mut p = String::new();
        io::stdin().read_line(&mut p).ok();
        let p = p.trim().to_string();
        if p.is_empty() {
            return;
        }
        load_folder(state, &p);
    } else {
        let path = args.join(" ");
        let path_obj = std::path::Path::new(&path);
        if path_obj.is_dir() {
            load_folder(state, &path);
        } else {
            let s = state.lock().unwrap();
            s.playlist.lock().unwrap().clear();
            s.playlist.lock().unwrap().push(path.clone());
            *s.current_index.lock().unwrap() = Some(0);
            drop(s);
            play_track(state, &path, 0);
        }
    }
}

fn load_folder(state: &Arc<Mutex<ServerState>>, dir: &str) {
    match crate::core::files::list_audio_files(dir) {
        Ok(files) => {
            if files.is_empty() {
                println!("No audio files found in directory.");
                return;
            }
            let s = state.lock().unwrap();
            *s.music_folder.lock().unwrap() = dir.to_string();
            s.playlist.lock().unwrap().clear();
            s.playlist.lock().unwrap().extend(files.clone());
            *s.current_index.lock().unwrap() = Some(0);
            let cur = s.current_pl.lock().unwrap().clone();
            if let Some(p) = s.playlists.lock().unwrap().iter_mut().find(|p| p.name == cur) {
                p.tracks = files.clone();
            }
            save_playlists(&s);
            println!("Loaded {} tracks from {}", files.len(), dir);
            if !files.is_empty() {
                let p = files[0].clone();
                drop(s);
                play_track(state, &p, 0);
            }
        }
        Err(e) => println!("Error listing audio files: {}", e),
    }
}

fn audio(state: &Arc<Mutex<ServerState>>, args: &[&str]) {
    let s = state.lock().unwrap();
    if let Some(m) = args.first() {
        if let Ok(am) = m.parse::<AudioMode>() {
            s.audio_engine.lock().unwrap().set_mode(am);
            println!("Audio mode set to: {}", am);
        } else {
            println!("Unknown audio mode: {}. Use normal/asio", m);
        }
    } else {
        println!("Audio mode: {}", s.audio_engine.lock().unwrap().get_mode());
    }
}

fn devices() {
    use cpal::traits::{DeviceTrait, HostTrait};
    if let Ok(h) = cpal::default_host().output_devices() {
        for (i, d) in h.enumerate() {
            if let Ok(desc) = d.description() {
                println!("  {}. {}", i + 1, desc.name());
            }
        }
    }
}

fn info(state: &Arc<Mutex<ServerState>>) {
    let s = state.lock().unwrap();
    let idx = s.current_index.lock().unwrap().unwrap_or(0);
    let path = s.playlist.lock().unwrap().get(idx).cloned();
    drop(s);
    if let Some(p) = path {
        match crate::core::metadata::read_metadata(&p) {
            Ok(m) => {
                println!("\n  Title:  {}", m.title);
                println!("  Artist: {}", m.artist);
                println!("  Album:  {}", m.album);
                if let Some(y) = m.year {
                    println!("  Year:   {}", y);
                }
                if let Some(g) = &m.genre {
                    println!("  Genre:  {}", g);
                }
                if m.duration.unwrap_or(0.0) > 0.0 {
                    println!("  Length: {}", format_time(m.duration.unwrap_or(0.0)));
                }
            }
            Err(e) => println!("Error reading metadata: {}", e),
        }
    } else {
        println!("No track loaded.");
    }
}

fn bar(state: &Arc<Mutex<ServerState>>, args: &[&str]) {
    let mut s = state.lock().unwrap();
    if args.is_empty() {
        let e = s.audio_engine.lock().unwrap();
        let b = bar_str(
            e.get_position(),
            e.get_duration(),
            s.progress_width,
            s.progress_filled,
            s.progress_empty,
        );
        println!(
            "\n  {}  [{}/{}]",
            b,
            format_time(e.get_position()),
            format_time(e.get_duration())
        );
        return;
    }
    match args[0] {
        "width" => {
            if let Some(w) = args.get(1).and_then(|a| a.parse::<u32>().ok()) {
                s.progress_width = w.clamp(10, 80);
            }
            println!("Progress width: {}", s.progress_width);
            save_settings(&s);
        }
        "char" | "chars" => {
            if args.len() >= 3 {
                if let Some(c) = args[1].chars().next() {
                    s.progress_filled = c;
                }
                if let Some(c) = args[2].chars().next() {
                    s.progress_empty = c;
                }
            }
            println!(
                "Progress chars: filled='{}' empty='{}'",
                s.progress_filled, s.progress_empty
            );
            save_settings(&s);
        }
        _ => println!("Usage: bar [width <n>|char <filled> <empty>]"),
    }
}

fn mode(state: &Arc<Mutex<ServerState>>, args: &[&str]) {
    let s = state.lock().unwrap();
    let modes = ["normal", "repeat-one", "repeat-all", "shuffle"];
    let names = ["Normal", "Repeat-One", "Repeat-All", "Shuffle"];
    let mode_str = {
        let mut pm = s.play_mode.lock().unwrap();
        if let Some(a) = args.first() {
            let al = a.to_lowercase();
            if let Some(i) = modes.iter().position(|m| *m == al) {
                *pm = modes[i].to_string();
            } else if let Some(i) = names.iter().position(|m| m.to_lowercase().starts_with(&al)) {
                *pm = modes[i].to_string();
            } else {
                println!("Unknown mode. Choose from: normal / repeat-one / repeat-all / shuffle");
                return;
            }
        } else {
            let i = (modes.iter().position(|m| *m == *pm).unwrap_or(0) + 1) % 4;
            *pm = modes[i].to_string();
        }
        pm.clone()
    };
    let idx = modes.iter().position(|m| *m == mode_str).unwrap_or(0);
    println!("Mode: {}", names[idx]);
    save_settings(&s);
}

fn pl(state: &Arc<Mutex<ServerState>>, args: &[&str]) {
    let s = state.lock().unwrap();
    let sub = args.first().copied().unwrap_or("");
    let rest = args.get(1..).unwrap_or(&[]);
    let mf = s.music_folder.lock().unwrap().clone();
    match sub {
        "create" | "new" => {
            let name = rest.first().copied().unwrap_or("");
            if name.is_empty() {
                println!("Usage: pl create <name> [desc]");
                return;
            }
            let desc = rest.get(1).copied().unwrap_or("");
            drop(s);
            match crate::core::playlist::create_playlist(
                &mf,
                name,
                if desc.is_empty() { None } else { Some(desc) },
                &[],
            ) {
                Ok(()) => {}
                Err(e) => {
                    if e == "duplicate" {
                        println!("Playlist '{}' already exists.", name);
                    } else {
                        println!("Error: {}", e);
                    }
                    return;
                }
            }
            let s = state.lock().unwrap();
            refresh_playlists_cache(&s);
            println!("Created playlist '{}'.", name);
        }
        "delete" | "rm" | "del" => {
            let name = rest.join(" ");
            if name.is_empty() {
                println!("Usage: pl delete <name>");
                return;
            }
            drop(s);
            match crate::core::playlist::delete_playlist(&mf, &name) {
                Ok(()) => {}
                Err(e) => {
                    if e == "not_found" {
                        println!("Playlist '{}' not found.", name);
                    } else if e == "last_one" {
                        println!("Cannot delete the last playlist.");
                    } else {
                        println!("Error: {}", e);
                    }
                    return;
                }
            }
            let s = state.lock().unwrap();
            refresh_playlists_cache(&s);
            sync_current_playlist(&s);
            *s.current_index.lock().unwrap() = None;
            println!("Deleted playlist '{}'.", name);
        }
        "list" | "ls" | "" => {
            let pls = s.playlists.lock().unwrap();
            let cur = s.current_pl.lock().unwrap();
            for p in pls.iter() {
                println!(
                    "{} {}  [{} tracks]",
                    if p.name == *cur { "▶" } else { " " },
                    p.name,
                    p.tracks.len()
                );
            }
        }
        "switch" | "sw" => {
            let name = rest.join(" ");
            if name.is_empty() {
                println!("Usage: pl switch <name>");
                return;
            }
            drop(s);
            match crate::core::playlist::switch_playlist(&mf, &name) {
                Ok(Some(_)) => {}
                Ok(None) => {
                    println!("Playlist '{}' not found.", name);
                    return;
                }
                Err(e) => {
                    println!("Error: {}", e);
                    return;
                }
            }
            let s = state.lock().unwrap();
            refresh_playlists_cache(&s);
            sync_current_playlist(&s);
            *s.current_index.lock().unwrap() = None;
            println!("Switched to playlist '{}'.", name);
        }
        "info" => {
            let name = if rest.is_empty() {
                s.current_pl.lock().unwrap().clone()
            } else {
                rest.join(" ")
            };
            if let Some(p) = s.playlists.lock().unwrap().iter().find(|p| p.name == name) {
                println!("\n  {}  [{} tracks]", p.name, p.tracks.len());
                if !p.desc.is_empty() {
                    println!("  {}", p.desc);
                }
                for (i, t) in p.tracks.iter().enumerate() {
                    let n = std::path::Path::new(t)
                        .file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_default();
                    println!("    {}. {}", i + 1, n);
                }
            } else {
                println!("Playlist '{}' not found.", name);
            }
        }
        _ => println!("Usage: pl create|delete|list|switch|info"),
    }
}

fn cd(state: &Arc<Mutex<ServerState>>, args: &[&str]) {
    let name = args.join(" ");
    if name.is_empty() {
        println!("Usage: cd <name>");
        return;
    }
    let s = state.lock().unwrap();
    let mf = s.music_folder.lock().unwrap().clone();
    drop(s);
    match crate::core::playlist::switch_playlist(&mf, &name) {
        Ok(Some(_)) => {}
        Ok(None) => {
            println!("Playlist '{}' not found.", name);
            return;
        }
        Err(e) => {
            println!("Error: {}", e);
            return;
        }
    }
    let s = state.lock().unwrap();
    refresh_playlists_cache(&s);
    sync_current_playlist(&s);
    *s.current_index.lock().unwrap() = None;
    println!("Switched to playlist '{}'.", name);
}

fn import(state: &Arc<Mutex<ServerState>>) {
    let (mf, cur) = {
        let s = state.lock().unwrap();
        let mf = s.music_folder.lock().unwrap().clone();
        let cur = s.current_pl.lock().unwrap().clone();
        (mf, cur)
    };
    if mf.is_empty() {
        println!("No music folder configured. Use 'open dir'.");
        return;
    }
    match crate::core::files::list_audio_files(&mf) {
        Ok(files) => {
            println!("Found {} audio files in {}. Enter indices (e.g. 1 3-5 all):", files.len(), mf);
            for (i, f) in files.iter().enumerate().take(20) {
                let n = std::path::Path::new(f)
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default();
                println!("  {}. {}", i + 1, n);
            }
            if files.len() > 20 {
                println!("  ... and {} more", files.len() - 20);
            }
            print!("> ");
            let _ = io::stdout().flush();
            let mut in_ = String::new();
            io::stdin().read_line(&mut in_).ok();
            let idxs = parse_range(&in_, files.len());
            if idxs.is_empty() {
                println!("None selected.");
                return;
            }
            let sel: Vec<String> = idxs.iter().map(|&i| files[i - 1].clone()).collect();
            if let Err(e) = crate::core::playlist::add_tracks(&mf, &cur, &sel) {
                println!("Error: {}", e);
                return;
            }
            let s = state.lock().unwrap();
            refresh_playlists_cache(&s);
            sync_current_playlist(&s);
            println!("Imported {} track(s) into '{}'.", sel.len(), cur);
        }
        Err(e) => println!("Error listing files: {}", e),
    }
}

fn track(state: &Arc<Mutex<ServerState>>, args: &[&str]) {
    let (pl, cur_pn) = {
        let s = state.lock().unwrap();
        let pl = s.playlist.lock().unwrap().clone();
        let cur_pn = s.current_pl.lock().unwrap().clone();
        (pl, cur_pn)
    };
    if pl.is_empty() {
        println!("Playlist is empty.");
        return;
    }
    let sub = args.first().copied().unwrap_or("");
    let rest = args.get(1..).unwrap_or(&[]);
    let select = || -> Vec<usize> {
        for (i, p) in pl.iter().enumerate() {
            let n = std::path::Path::new(p)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            println!("  {}. {}", i + 1, n);
        }
        print!("Select (n / n-r / all): ");
        let _ = io::stdout().flush();
        let mut in_ = String::new();
        io::stdin().read_line(&mut in_).ok();
        parse_range(&in_, pl.len())
    };

    match sub {
        "" | "info" => {
            if rest.is_empty() {
                let ts = select();
                for &i in ts.iter().filter(|&&i| i >= 1 && i <= pl.len()) {
                    if let Ok(m) = crate::core::metadata::read_metadata(&pl[i - 1]) {
                        println!(
                            "\n  {}. {}  [{}]",
                            i,
                            m.title,
                            format_time(m.duration.unwrap_or(0.0))
                        );
                    }
                }
            } else if let Ok(n) = rest[0].parse::<usize>() {
                if n >= 1 && n <= pl.len() {
                    info(state);
                } else {
                    println!("Invalid track number.");
                }
            }
        }
        "delete" | "del" => {
            let ts = select();
            if ts.is_empty() {
                return;
            }
            let s = state.lock().unwrap();
            let mut pls = s.playlists.lock().unwrap();
            if let Some(p) = pls.iter_mut().find(|p| p.name == cur_pn) {
                let sel_p: Vec<String> = ts
                    .iter()
                    .filter_map(|&i| if i >= 1 && i <= pl.len() { Some(pl[i - 1].clone()) } else { None })
                    .collect();
                let before = p.tracks.len();
                p.tracks.retain(|t| !sel_p.contains(t));
                drop(pls);
                save_playlists(&s);
                sync_current_playlist(&s);
                println!("Removed {} track(s) from '{}'.", before - s.playlist.lock().unwrap().len(), cur_pn);
            }
        }
        _ => println!("Usage: t [info|delete] [n]"),
    }
}

fn print_help() {
    println!();
    println!("  MusiCLI v{} — Command Reference", env!("CARGO_PKG_VERSION"));
    println!();
    println!("  Playback:    play [n|name] / pause / stop / next / prev / seek <s> / vol <0-100>");
    println!("  Lyrics:      lyric [on|off|status] — toggle or set terminal lyrics display");
    println!("  Mode:        mode [normal|repeat-one|repeat-all|shuffle]");
    println!("  Library:     open <dir|file> / list [page] / info / t [info|del]");
    println!("  Playlists:   pl [create|del|list|switch|info] / cd <name> / import");
    println!("  Output:      audio [normal|asio] / devices / bar [width|char]");
    println!("  System:      status / clear / help / quit");
    println!();
    println!("  WebUI:       lp (LocalPlay) — launch default browser with local Sakura WebUI");
    println!("               listen [open|ui] — show port/URL, switch or open Listen WebUI");
    println!("               pocket [open|ui|pw] — show port/URL, switch UI, manage password");
    println!();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_time() {
        assert_eq!(format_time(0.0), "0:00");
        assert_eq!(format_time(65.0), "1:05");
        assert_eq!(format_time(3665.0), "1:01:05");
    }

    #[test]
    fn test_next_index_normal() {
        assert_eq!(next_index(0, 3, "normal"), Some(1));
        assert_eq!(next_index(1, 3, "normal"), Some(2));
        assert_eq!(next_index(2, 3, "normal"), None);
    }

    #[test]
    fn test_next_index_repeat_one() {
        assert_eq!(next_index(1, 3, "repeat-one"), Some(1));
        assert_eq!(next_index(0, 3, "repeat-one"), Some(0));
    }

    #[test]
    fn test_next_index_repeat_all() {
        assert_eq!(next_index(0, 3, "repeat-all"), Some(1));
        assert_eq!(next_index(1, 3, "repeat-all"), Some(2));
        assert_eq!(next_index(2, 3, "repeat-all"), Some(0));
    }

    #[test]
    fn test_next_index_shuffle() {
        let idx = next_index(0, 5, "shuffle");
        assert!(idx.is_some());
        assert!(idx.unwrap() < 5);
    }

    #[test]
    fn test_prev_index() {
        assert_eq!(prev_index(2, 3, "normal"), 1);
        assert_eq!(prev_index(1, 3, "normal"), 0);
        assert_eq!(prev_index(0, 3, "normal"), 2);
    }

    #[test]
    fn test_truncate_line() {
        assert_eq!(truncate_line("hello world", 5), "hello");
        assert_eq!(truncate_line("\x1B[36mhello\x1B[0m world", 5), "\x1B[36mhello\x1B[0m");
    }

    #[test]
    fn test_print_banner() {
        print_banner();
    }

    #[test]
    fn test_match_skin_choice() {
        let skins = vec![
            "sakura.html".to_string(),
            "cyberpunk.html".to_string(),
            "retro.html".to_string(),
        ];

        // Numeric 1-based index
        assert_eq!(match_skin_choice("1", &skins), Some("sakura.html".to_string()));
        assert_eq!(match_skin_choice("2", &skins), Some("cyberpunk.html".to_string()));
        assert_eq!(match_skin_choice("3", &skins), Some("retro.html".to_string()));
        assert_eq!(match_skin_choice("4", &skins), None);

        // Exact match
        assert_eq!(match_skin_choice("cyberpunk.html", &skins), Some("cyberpunk.html".to_string()));

        // Stem match without .html
        assert_eq!(match_skin_choice("cyberpunk", &skins), Some("cyberpunk.html".to_string()));

        // Partial match
        assert_eq!(match_skin_choice("cyber", &skins), Some("cyberpunk.html".to_string()));

        // Non-matching
        assert_eq!(match_skin_choice("neon", &skins), None);
    }

    #[test]
    fn test_get_local_ip_no_panic() {
        let _ = get_local_ip();
    }
}

