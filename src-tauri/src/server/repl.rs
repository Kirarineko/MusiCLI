use std::io::{self, Write};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use rustyline::error::ReadlineError;
use rustyline::{DefaultEditor, ExternalPrinter};

use crate::audio::AudioMode;
use crate::server_state::{NamedPlaylist, ServerState};

pub fn format_time(secs: f64) -> String {
    let secs = secs as u64;
    let h = secs / 3600; let m = (secs % 3600) / 60; let s = secs % 60;
    if h > 0 { format!("{}:{:02}:{:02}", h, m, s) } else { format!("{}:{:02}", m, s) }
}

fn term_width() -> usize {
    std::env::var("COLUMNS").ok().and_then(|s| s.parse().ok()).unwrap_or(80)
}

fn display_width(s: &str) -> usize {
    s.chars().map(|c| if (c as u32) > 0x7F { 2 } else { 1 }).sum()
}

fn visual_lines(s: &str) -> usize {
    let tw = term_width();
    s.split('\n').map(|seg| {
        let w = display_width(seg);
        if w == 0 { 1 } else { (w + tw - 1) / tw }
    }).sum::<usize>().max(1)
}

fn bar_str(pos: f64, dur: f64, w: u32, fill: char, empty: char) -> String {
    if dur <= 0.0 { return format!("[{}{}]", empty, empty.to_string().repeat(w.saturating_sub(1) as usize)); }
    let ratio = (pos / dur).clamp(0.0, 1.0);
    let f = (ratio * w as f64).round() as usize;
    let r = w.saturating_sub(f as u32) as usize;
    if f == 0 { format!("[{}{}]", empty, empty.to_string().repeat(r.saturating_sub(1))) }
    else { format!("[{}{}{}]", fill.to_string().repeat(f - 1), ">", empty.to_string().repeat(r)) }
}

fn parse_range(input: &str, max: usize) -> Vec<usize> {
    let mut result = Vec::new();
    for part in input.split_whitespace() {
        let part = part.trim().trim_end_matches(',');
        if part.eq_ignore_ascii_case("all") { return (1..=max).collect(); }
        if let Some((a, b)) = part.split_once('-') {
            let lo = a.trim().parse().unwrap_or(1); let hi = b.trim().parse().unwrap_or(max);
            for i in lo..=hi.min(max) { if i >= 1 { result.push(i); } }
        } else if let Ok(n) = part.parse::<usize>() {
            if n >= 1 && n <= max { result.push(n); }
        }
    }
    result.sort(); result.dedup(); result
}

fn load_config(s: &mut ServerState) {
    let mf = s.music_folder.lock().unwrap().clone(); if mf.is_empty() { return; }
    if let Ok(Some(v)) = crate::core::files::read_config(&mf, "settings") {
        if let Some(o) = v.as_object() {
            if let Some(x) = o.get("volume").and_then(|v| v.as_u64()) { s.audio_engine.lock().unwrap().set_volume(x as u32); }
            if let Some(x) = o.get("progressWidth").and_then(|v| v.as_u64()) { s.progress_width = x as u32; }
            if let Some(x) = o.get("progressFilled").and_then(|v| v.as_str()) { if let Some(c) = x.chars().next() { s.progress_filled = c; } }
            if let Some(x) = o.get("progressEmpty").and_then(|v| v.as_str()) { if let Some(c) = x.chars().next() { s.progress_empty = c; } }
            if let Some(x) = o.get("lyricsTerminal").and_then(|v| v.as_bool()) { *s.lrc_enabled.lock().unwrap() = x; }
            if let Some(x) = o.get("lyricsNextCount").and_then(|v| v.as_u64()) { *s.lrc_next_count.lock().unwrap() = x as usize; }
        }
    }
}

fn refresh_playlists_cache(s: &ServerState) {
    let mf = s.music_folder.lock().unwrap().clone(); if mf.is_empty() { return; }
    if let Ok(infos) = crate::core::playlist::list_playlists(&mf) {
        let mut list = s.playlists.lock().unwrap();
        list.clear();
        for info in infos {
            let tracks = crate::core::playlist::get_playlist(&mf, &info.name)
                .ok().flatten()
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
    let mf = s.music_folder.lock().unwrap().clone(); if mf.is_empty() { return; }
    let pls = s.playlists.lock().unwrap();
    let cur = s.current_pl.lock().unwrap().clone();
    let data: serde_json::Map<String, serde_json::Value> = pls.iter().map(|p| {
        (p.name.clone(), serde_json::json!({
            "name": p.name, "desc": p.desc, "created_at": p.created_at,
            "updated_at": null, "sharer": null, "tracks": p.tracks,
        }))
    }).collect();
    let playlists_file = serde_json::json!({ "playlists": data, "current": cur });
    let path = std::path::Path::new(&mf).join("config").join("playlists.json");
    if let Some(parent) = path.parent() { std::fs::create_dir_all(parent).ok(); }
    let _ = std::fs::write(&path, serde_json::to_string_pretty(&playlists_file).unwrap_or_default());
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
    let mut lines = s.lrc_lines.lock().unwrap(); lines.clear(); *s.lrc_last_idx.lock().unwrap() = -1; *s.lrc_loaded_for.lock().unwrap() = mp3_path.to_string();
    let mf = s.music_folder.lock().unwrap().clone(); if mf.is_empty() { return; }
    if let Ok(Some(lrc_path)) = crate::core::lyrics::find_lrc(mp3_path, &mf) {
        if let Ok(content) = crate::core::files::read_file(&lrc_path) { *lines = crate::lrc_parser::parse_lrc(&content); }
    }
}

// ── Config persistence ─────────────────────────────────────────────

fn save_settings(s: &ServerState) {
    let mf = s.music_folder.lock().unwrap().clone();
    if mf.is_empty() { return; }
    let mut obj = serde_json::Map::new();
    obj.insert("volume".into(), serde_json::json!(s.audio_engine.lock().unwrap().get_volume()));
    obj.insert("progressWidth".into(), serde_json::json!(s.progress_width));
    obj.insert("progressFilled".into(), serde_json::json!(s.progress_filled.to_string()));
    obj.insert("progressEmpty".into(), serde_json::json!(s.progress_empty.to_string()));
    obj.insert("lyricsTerminal".into(), serde_json::json!(*s.lrc_enabled.lock().unwrap()));
    obj.insert("lyricsNextCount".into(), serde_json::json!(*s.lrc_next_count.lock().unwrap()));
    obj.insert("playMode".into(), serde_json::json!(s.play_mode.lock().unwrap().clone()));
    let _ = crate::core::files::write_config(&mf, "settings", &serde_json::Value::Object(obj));
}

// ── Status thread (uses rustyline ExternalPrinter) ──

fn spawn_status(st: Arc<Mutex<ServerState>>, mut printer: impl ExternalPrinter + Send + 'static) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let mut last_pos = -1.0;
        let mut prev_lines: usize = 0;
        loop {
            thread::sleep(Duration::from_millis(200));
            let s = st.lock().unwrap(); let engine = s.audio_engine.lock().unwrap();
            if !engine.is_playing() { break; }
            let pos = engine.get_position(); let dur = engine.get_duration();
            if dur <= 0.0 { continue; }
            let mode = match s.play_mode.lock().unwrap().as_str() { "repeat-one" => "[1]", "repeat-all" => "[A]", "shuffle" => "[S]", _ => "", };
            let track = s.current_index.lock().unwrap().and_then(|i| s.playlist.lock().unwrap().get(i).cloned())
                .and_then(|p| std::path::Path::new(&p).file_name().map(|n| n.to_string_lossy().to_string())).unwrap_or_default();
            let bar = bar_str(pos, dur, s.progress_width, s.progress_filled, s.progress_empty);
            let mut output = format!("  {} {}  {}  [{}/{}]  vol: {}", mode, track, bar, format_time(pos), format_time(dur), engine.get_volume());
            let ll = s.lrc_lines.lock().unwrap();
            if *s.lrc_enabled.lock().unwrap() && !ll.is_empty() {
                let ci = crate::lrc_parser::get_current_line_idx(&ll, pos);
                if ci >= 0 {
                    output.push_str(&format!("\n  \x1B[33m♪\x1B[0m {}", ll[ci as usize].text));
                    let nc = *s.lrc_next_count.lock().unwrap();
                    for i in 1..=nc.min(ll.len().saturating_sub(ci as usize + 1)) {
                        let idx = ci as usize + i;
                        if idx < ll.len() {
                            output.push_str(&format!("\n    {}", ll[idx].text));
                        }
                    }
                }
            }
            drop(ll); drop(engine); drop(s);
            if (pos - last_pos).abs() > 0.5 {
                last_pos = pos;
                let cur_lines = visual_lines(&output) + 1; // +1 for printer's trailing newline
                if prev_lines > 0 {
                    output = format!("\x1B[{}A\x1B[J{}", prev_lines, output);
                }
                prev_lines = cur_lines;
                let _ = printer.print(output);
            }
        }
        if prev_lines > 0 {
            let _ = printer.print(format!("\x1B[{}A\x1B[J", prev_lines));
        }
    })
}

// ── Main REPL ──

pub fn run_repl(state: Arc<Mutex<ServerState>>, _server_url: Option<&str>) {
    let mut rl = DefaultEditor::new().expect("rustyline");
    let _ = rl.load_history("/tmp/musicli_history");
    println!();
    println!("  MusiCLI v{}  [RealCLI Mode]", env!("CARGO_PKG_VERSION"));

    {
        let mut s = state.lock().unwrap();
        if s.music_folder.lock().unwrap().is_empty() {
            let dir = dirs::audio_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
            *s.music_folder.lock().unwrap() = dir.to_string_lossy().to_string();
        }
        load_config(&mut s); load_playlists(&s); sync_current_playlist(&s);
    }

    let mut handle: Option<thread::JoinHandle<()>> = None;

    loop {
        let prompt = { let s = state.lock().unwrap(); let engine = s.audio_engine.lock().unwrap();
            let mode = match s.play_mode.lock().unwrap().as_str() { "repeat-one" => "[1]", "repeat-all" => "[A]", "shuffle" => "[S]", _ => "", };
            if engine.is_playing() { format!("\x1B[33m>{}\x1B[0m ", mode) } else { "\x1B[33m>\x1B[0m ".to_string() }
        };
        match rl.readline(&prompt) {
            Ok(line) => {
                let line = line.trim().to_string(); if line.is_empty() { continue; }
                let _ = rl.add_history_entry(&line);
                let was = state.lock().unwrap().audio_engine.lock().unwrap().is_playing();
                if exec(&state, &line) { break; }
                let now = state.lock().unwrap().audio_engine.lock().unwrap().is_playing();
                if !was && now {
                    if let Some(h) = handle.take() { h.join().ok(); }
                    if let Ok(printer) = rl.create_external_printer() {
                        handle = Some(spawn_status(state.clone(), printer));
                    }
                } else if was && !now {
                    if let Some(h) = handle.take() { h.join().ok(); }
                }
            }
            Err(ReadlineError::Interrupted)|Err(ReadlineError::Eof) => { println!("quit"); break; }
            Err(e) => { eprintln!("Error: {}", e); break; }
        }
    }
    if let Some(h) = handle.take() { h.join().ok(); }
    let _ = rl.save_history("/tmp/musicli_history");
}

// ── Dispatch ──

fn exec(state: &Arc<Mutex<ServerState>>, raw: &str) -> bool {
    let parts: Vec<&str> = raw.split_whitespace().collect(); if parts.is_empty() { return false; }
    let cmd = parts[0].to_lowercase(); let args: &[&str] = &parts[1..];
    match cmd.as_str() {
        "quit"|"exit"|"q" => { if let Ok(s) = state.lock() { s.audio_engine.lock().unwrap().stop(); } println!("Goodbye."); true }
        "help"|"?"|"h" => { print_help(); false }
        "play"|"resume" => { play(state, args); false }
        "pause"|"paus" => { state.lock().unwrap().audio_engine.lock().unwrap().pause(); println!("Paused."); false }
        "stop" => { state.lock().unwrap().audio_engine.lock().unwrap().stop(); println!("Stopped."); false }
        "next"|"n"|"skip" => { nxt(state); false }
        "prev"|"p"|"back"|"previous" => { prv(state); false }
        "seek"|"goto" => { seek(state, args); false }
        "vol"|"volume" => { vol(state, args); false }
        "list"|"ls" => { list(state, args); false }
        "open"|"load" => { open(state, args); false }
        "audio"|"aud" => { audio(state, args); false }
        "devices" => { devices(); false }
        "info"|"meta"|"metadata" => { info(state); false }
        "clear"|"cls" => { print!("\x1B[2J\x1B[1;1H"); false }
        "bar" => { bar(state, args); false }
        "lyric"|"lyrics"|"lrc" => { lyric(state, args); false }
        "mode"|"loop"|"repeat" => { mode(state, args); false }
        "pl" => { pl(state, args); false }
        "cd" => { cd(state, args); false }
        "import" => { import(state); false }
        "t"|"track" => { track(state, args); false }
        _ => { println!("Unknown: {}. Type 'help'.", cmd); false }
    }
}

fn play(state: &Arc<Mutex<ServerState>>, args: &[&str]) {
    let s = state.lock().unwrap(); let pl = s.playlist.lock().unwrap().clone(); if pl.is_empty() { println!("No tracks."); return; }
    let idx = if args.is_empty() { s.current_index.lock().unwrap().unwrap_or(0) }
    else if let Ok(n) = args[0].parse::<usize>() { if n<1||n>pl.len() { println!("1-{}",pl.len()); return; } n-1 }
    else {
        let q = args.join(" ").to_lowercase(); let m: Vec<usize> = pl.iter().enumerate().filter(|(_,p)| std::path::Path::new(p).file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default().contains(&q)).map(|(i,_)| i).collect();
        if m.is_empty() { println!("No match"); return; }
        if m.len()==1 { m[0] } else {
            for (i,&mi) in m.iter().enumerate() { println!("  {}. {}", i+1, std::path::Path::new(&pl[mi]).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default()); }
            print!("Select: "); let _=io::stdout().flush(); let mut in_=String::new(); io::stdin().read_line(&mut in_).ok();
            let p=in_.trim().parse::<usize>().unwrap_or(0); if p<1||p>m.len() { return; } m[p-1]
        }
    };
    let path = pl[idx].clone(); drop(s); play_track(state, &path, idx);
}

fn play_track(state: &Arc<Mutex<ServerState>>, path: &str, idx: usize) {
    let s = state.lock().unwrap(); let mut engine = s.audio_engine.lock().unwrap();
    match engine.play(path) { Ok(()) => { *s.current_index.lock().unwrap() = Some(idx);
        let name = std::path::Path::new(path).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        println!("\n▶ {}  [{}/{}]", name, "0:00", format_time(engine.get_duration())); load_lyrics(&s, path); }
        Err(e) => println!("Error: {}", e), }
}

fn nxt(state: &Arc<Mutex<ServerState>>) { let s=state.lock().unwrap(); let pl=s.playlist.lock().unwrap().clone(); if pl.is_empty(){println!("No tracks.");return;} let cur=s.current_index.lock().unwrap().unwrap_or(0); let idx=if cur+1<pl.len(){cur+1}else{0}; let path=pl[idx].clone(); drop(s); play_track(state, &path, idx); }
fn prv(state: &Arc<Mutex<ServerState>>) { let s=state.lock().unwrap(); let pl=s.playlist.lock().unwrap().clone(); if pl.is_empty(){println!("No tracks.");return;} let cur=s.current_index.lock().unwrap().unwrap_or(0); let idx=if cur>0{cur-1}else{pl.len().saturating_sub(1)}; let path=pl[idx].clone(); drop(s); play_track(state, &path, idx); }
fn seek(state: &Arc<Mutex<ServerState>>, args: &[&str]) { if let Some(a)=args.first().and_then(|a|a.parse::<f64>().ok()){state.lock().unwrap().audio_engine.lock().unwrap().seek(a);println!("Seek: {}",format_time(a));}else{println!("seek <seconds>");} }
fn vol(state: &Arc<Mutex<ServerState>>, args: &[&str]) { let s=state.lock().unwrap(); if let Some(v)=args.first().and_then(|a|a.parse::<u32>().ok()){s.audio_engine.lock().unwrap().set_volume(v.min(100));println!("Vol: {}",v.min(100)); save_settings(&s); }else{println!("Vol: {}",s.audio_engine.lock().unwrap().get_volume());} }

fn list(state: &Arc<Mutex<ServerState>>, args: &[&str]) { let s=state.lock().unwrap(); let pl=s.playlist.lock().unwrap(); if pl.is_empty(){println!("Playlist empty.");return;} let page=args.first().and_then(|a|a.parse::<usize>().ok()).unwrap_or(1).max(1); let ps=20; let start=(page-1)*ps; let end=(start+ps).min(pl.len()); println!("Tracks {}-{} / {}  (page {})",start+1,end,pl.len(),page); let cur=*s.current_index.lock().unwrap(); for i in start..end { let n=std::path::Path::new(&pl[i]).file_name().map(|n|n.to_string_lossy().to_string()).unwrap_or_default(); println!("{} {}. {}",if Some(i)==cur{"▶"}else{" "},i+1,n); } }

fn open(state: &Arc<Mutex<ServerState>>, args: &[&str]) { if args.first()==Some(&"dir")||args.is_empty(){print!("Music directory: ");let _=io::stdout().flush();let mut p=String::new();io::stdin().read_line(&mut p).ok();let p=p.trim().to_string();if p.is_empty(){return;}load_folder(state,&p);}else{let path=args.join(" ");let s=state.lock().unwrap();s.playlist.lock().unwrap().clear();s.playlist.lock().unwrap().push(path.clone());*s.current_index.lock().unwrap()=Some(0);drop(s);play_track(state,&path,0);} }

fn load_folder(state: &Arc<Mutex<ServerState>>, dir: &str) { match crate::core::files::list_audio_files(dir){ Ok(files)=>{ if files.is_empty(){println!("No audio files.");return;} let s=state.lock().unwrap();*s.music_folder.lock().unwrap()=dir.to_string();s.playlist.lock().unwrap().clear();s.playlist.lock().unwrap().extend(files.clone());*s.current_index.lock().unwrap()=Some(0);let cur=s.current_pl.lock().unwrap().clone();if let Some(p)=s.playlists.lock().unwrap().iter_mut().find(|p|p.name==cur){p.tracks=files.clone();}save_playlists(&s);println!("Loaded {} tracks from {}",files.len(),dir);if !files.is_empty(){let p=files[0].clone();drop(s);play_track(state,&p,0);}} Err(e)=>println!("Error: {}",e), } }

fn audio(state: &Arc<Mutex<ServerState>>, args: &[&str]) { let s=state.lock().unwrap(); if let Some(m)=args.first(){ if let Some(am)=AudioMode::from_str(m){s.audio_engine.lock().unwrap().set_mode(am);println!("Mode: {}",am);}else{println!("Unknown: {}. Use normal/asio",m);} }else{println!("Mode: {}",s.audio_engine.lock().unwrap().get_mode());} }

fn devices() { use cpal::traits::{DeviceTrait,HostTrait}; if let Ok(h)=cpal::default_host().output_devices(){for(i,d) in h.enumerate(){if let Ok(desc)=d.description(){println!("  {}. {}",i+1,desc.name());}}} }

fn info(state: &Arc<Mutex<ServerState>>) { let s=state.lock().unwrap(); let idx=s.current_index.lock().unwrap().unwrap_or(0); let path=s.playlist.lock().unwrap().get(idx).cloned(); drop(s); if let Some(p)=path { match crate::core::metadata::read_metadata(&p){ Ok(m)=>{ println!("\n  {}",m.title);println!("  Artist: {}",m.artist);println!("  Album:  {}",m.album);if let Some(y)=m.year{println!("  Year:   {}",y);}if let Some(g)=&m.genre{println!("  Genre:  {}",g);}if m.duration.unwrap_or(0.0)>0.0{println!("  Length: {}",format_time(m.duration.unwrap_or(0.0)));}} Err(e)=>println!("Error: {}",e),} } else { println!("No track."); } }

fn bar(state: &Arc<Mutex<ServerState>>, args: &[&str]) { let mut s=state.lock().unwrap(); if args.is_empty(){let e=s.audio_engine.lock().unwrap();let b=bar_str(e.get_position(),e.get_duration(),s.progress_width,s.progress_filled,s.progress_empty);println!("\n  {}  [{}/{}]",b,format_time(e.get_position()),format_time(e.get_duration()));return;} match args[0]{"width"=>{if let Some(w)=args.get(1).and_then(|a|a.parse::<u32>().ok()){s.progress_width=w.clamp(10,80);} println!("Width: {}",s.progress_width); save_settings(&s); }"char"|"chars"=>{if args.len()>=3{if let Some(c)=args[1].chars().next(){s.progress_filled=c;}if let Some(c)=args[2].chars().next(){s.progress_empty=c;}} println!("Chars: f='{}' e='{}'",s.progress_filled,s.progress_empty); save_settings(&s); }_=>println!("bar [width <n>|char <f> <e>]"),} }

fn lyric(state: &Arc<Mutex<ServerState>>, args: &[&str]) { let s=state.lock().unwrap(); if args.is_empty(){println!("Lyrics: {}",if *s.lrc_enabled.lock().unwrap(){"on"}else{"off"});return;} match args[0]{"t"|"on"|"terminal"=>{*s.lrc_enabled.lock().unwrap()=true;*s.lrc_last_idx.lock().unwrap()=-1;println!("Terminal lyrics on."); save_settings(&s); }"f"|"off"=>{*s.lrc_enabled.lock().unwrap()=false;println!("Off."); save_settings(&s); }"next"=>{if let Some(n)=args.get(1).and_then(|a|a.parse::<usize>().ok()){*s.lrc_next_count.lock().unwrap()=n.min(10);} println!("Next: {}",*s.lrc_next_count.lock().unwrap()); save_settings(&s); }_=>println!("lyric [t|f|next <n>]"),} }

fn mode(state: &Arc<Mutex<ServerState>>, args: &[&str]) { let s=state.lock().unwrap(); let modes=["normal","repeat-one","repeat-all","shuffle"]; let names=["Normal","Repeat-One","Repeat-All","Shuffle"]; let mut pm=s.play_mode.lock().unwrap(); if let Some(a)=args.first(){let al=a.to_lowercase();if let Some(i)=modes.iter().position(|m|*m==al){*pm=modes[i].to_string();}else if let Some(i)=names.iter().position(|m|m.to_lowercase().starts_with(&al)){*pm=modes[i].to_string();}else{println!("Unknown. Use normal/repeat-one/repeat-all/shuffle");return;}}else{let i=(modes.iter().position(|m|*m==*pm).unwrap_or(0)+1)%4;*pm=modes[i].to_string();} println!("Mode: {}",names[modes.iter().position(|m|*m==*pm).unwrap_or(0)]); save_settings(&s); }

fn pl(state: &Arc<Mutex<ServerState>>, args: &[&str]) { let s=state.lock().unwrap(); let sub=args.first().copied().unwrap_or(""); let rest=args.get(1..).unwrap_or(&[]); let mf=s.music_folder.lock().unwrap().clone();
match sub { "create"|"new"=>{ let name=rest.first().copied().unwrap_or("");if name.is_empty(){println!("pl create <name> [desc]");return;} let desc=rest.get(1).copied().unwrap_or(""); drop(s); match crate::core::playlist::create_playlist(&mf, name, if desc.is_empty() { None } else { Some(desc) }, &[]) { Ok(())=>{} Err(e)=>if e=="duplicate"{println!("'{}' exists.",name);return;}else{println!("Error: {}",e);return;} } let s=state.lock().unwrap();refresh_playlists_cache(&s);println!("Created '{}'.",name); }
"delete"|"rm"|"del"=>{ let name=rest.join(" ");if name.is_empty(){println!("pl delete <name>");return;} drop(s); match crate::core::playlist::delete_playlist(&mf, &name) { Ok(())=>{} Err(e)=>if e=="not_found"{println!("Not found: {}",name);return;}else if e=="last_one"{println!("Cannot delete last playlist.");return;}else{println!("Error: {}",e);return;} } let s=state.lock().unwrap();refresh_playlists_cache(&s);sync_current_playlist(&s);*s.current_index.lock().unwrap()=None;println!("Deleted '{}'.",name); }
"list"|"ls"|""=>{ let pls=s.playlists.lock().unwrap();let cur=s.current_pl.lock().unwrap();for p in pls.iter(){println!("{} {}  [{}]",if p.name==*cur{"▶"}else{" "},p.name,p.tracks.len());} }
"switch"|"sw"=>{ let name=rest.join(" ");if name.is_empty(){println!("pl switch <name>");return;} drop(s); match crate::core::playlist::switch_playlist(&mf, &name) { Ok(Some(_))=>{} Ok(None)=>{println!("Not found: {}",name);return;} Err(e)=>{println!("Error: {}",e);return;} } let s=state.lock().unwrap();refresh_playlists_cache(&s);sync_current_playlist(&s);*s.current_index.lock().unwrap()=None;println!("Switched to '{}'.",name); }
"info"=>{ let name=if rest.is_empty(){s.current_pl.lock().unwrap().clone()}else{rest.join(" ")};if let Some(p)=s.playlists.lock().unwrap().iter().find(|p|p.name==name){println!("\n  {}  [{} tracks]",p.name,p.tracks.len());if !p.desc.is_empty(){println!("  {}",p.desc);}for (i,t) in p.tracks.iter().enumerate(){let n=std::path::Path::new(t).file_name().map(|n|n.to_string_lossy().to_string()).unwrap_or_default();println!("    {}. {}",i+1,n);}}else{println!("Not found: {}",name);} }
_=>println!("pl create|delete|list|switch|info"), } }

fn cd(state: &Arc<Mutex<ServerState>>, args: &[&str]) { let name=args.join(" "); if name.is_empty(){println!("cd <name>");return;} let s=state.lock().unwrap(); let mf=s.music_folder.lock().unwrap().clone(); drop(s); match crate::core::playlist::switch_playlist(&mf, &name){ Ok(Some(_))=>{} Ok(None)=>{println!("Not found: {}",name);return;} Err(e)=>{println!("Error: {}",e);return;} } let s=state.lock().unwrap();refresh_playlists_cache(&s);sync_current_playlist(&s);*s.current_index.lock().unwrap()=None;println!("Switched to '{}'.",name); }

fn import(state: &Arc<Mutex<ServerState>>) { let s=state.lock().unwrap(); let mf=s.music_folder.lock().unwrap().clone(); if mf.is_empty(){println!("No music folder. Use 'open dir'.");return;} match crate::core::files::list_audio_files(&mf){Ok(files)=>{println!("{} files in {}. Enter n/n-r/all:",files.len(),mf);for(i,f) in files.iter().enumerate().take(20){let n=std::path::Path::new(f).file_name().map(|n|n.to_string_lossy().to_string()).unwrap_or_default();println!("  {}. {}",i+1,n);}if files.len()>20{println!("  ... and {} more",files.len()-20);}print!("> ");let _=io::stdout().flush();let mut in_=String::new();io::stdin().read_line(&mut in_).ok();let idxs=parse_range(&in_,files.len());if idxs.is_empty(){println!("None selected.");return;}let sel:Vec<String>=idxs.iter().map(|&i|files[i-1].clone()).collect();let cur=s.current_pl.lock().unwrap().clone();drop(s);if let Err(e)=crate::core::playlist::add_tracks(&mf, &cur, &sel){println!("Error: {}",e);return;}let s=state.lock().unwrap();refresh_playlists_cache(&s);sync_current_playlist(&s);println!("Imported {} to '{}'.",sel.len(),cur);}Err(e)=>println!("Error: {}",e),} }

fn track(state: &Arc<Mutex<ServerState>>, args: &[&str]) { let s=state.lock().unwrap(); let pl=s.playlist.lock().unwrap().clone(); if pl.is_empty(){println!("Playlist empty.");return;} let sub=args.first().copied().unwrap_or(""); let rest=args.get(1..).unwrap_or(&[]);
let select=||->Vec<usize>{for(i,p) in pl.iter().enumerate(){let n=std::path::Path::new(p).file_name().map(|n|n.to_string_lossy().to_string()).unwrap_or_default();println!("  {}. {}",i+1,n);}print!("Select (n/n-r/all): ");let _=io::stdout().flush();let mut in_=String::new();io::stdin().read_line(&mut in_).ok();parse_range(&in_,pl.len())};
let sel_pl=|s:&ServerState|->Option<String>{let pls=s.playlists.lock().unwrap();if pls.is_empty(){return None;}for(i,p) in pls.iter().enumerate(){println!("  {}. {}",i+1,p.name);}print!("Select playlist: ");let _=io::stdout().flush();let mut in_=String::new();io::stdin().read_line(&mut in_).ok();in_.trim().parse::<usize>().ok().and_then(|n|pls.get(n-1).map(|p|p.name.clone()))};
 match sub { ""|"info"=>{ if rest.is_empty(){let ts=select();for &i in ts.iter().filter(|&&i|i>=1&&i<=pl.len()){if let Ok(m)=crate::core::metadata::read_metadata(&pl[i-1]){println!("\n  {}. {}  [{}]",i,m.title,format_time(m.duration.unwrap_or(0.0)));}}}else if let Ok(n)=rest[0].parse::<usize>(){if n>=1&&n<=pl.len(){info(state);}else{println!("Invalid number.");}}else{let q=rest.join(" ").to_lowercase();let ms:Vec<usize>=pl.iter().enumerate().filter(|(_,p)|std::path::Path::new(p).file_name().map(|n|n.to_string_lossy().to_lowercase()).unwrap_or_default().contains(&q)).map(|(i,_)|i+1).collect();if ms.is_empty(){println!("No match.");}else if ms.len()==1{if let Ok(m)=crate::core::metadata::read_metadata(&pl[ms[0]-1]){println!("\n  {}",m.title);}}else{for &mi in &ms{println!("  {}. {}",mi,std::path::Path::new(&pl[mi-1]).file_name().map(|n|n.to_string_lossy().to_string()).unwrap_or_default());}}} }
"delete"=>{ let ts=select(); if ts.is_empty(){return;} if let Some(pn)=sel_pl(&s){let mut pls=s.playlists.lock().unwrap();if let Some(p)=pls.iter_mut().find(|p|p.name==pn){let sel_p:Vec<String>=ts.iter().filter_map(|&i|if i>=1&&i<=pl.len(){Some(pl[i-1].clone())}else{None}).collect();let before=p.tracks.len();p.tracks.retain(|t|!sel_p.contains(t));save_playlists(&s);if pn==*s.current_pl.lock().unwrap(){sync_current_playlist(&s);}println!("Removed {} from '{}'.",before-p.tracks.len(),pn);}} }
"move"=>{ let ts=select(); if ts.is_empty(){return;} if let Some(pn)=sel_pl(&s){let sel_p:Vec<String>=ts.iter().filter_map(|&i|if i>=1&&i<=pl.len(){Some(pl[i-1].clone())}else{None}).collect();let dp=s.playlists.lock().unwrap().first().map(|p|p.name.clone()).unwrap_or_default();let mut pls=s.playlists.lock().unwrap();for p in pls.iter_mut(){if p.name!=pn&&p.name!=dp{p.tracks.retain(|t|!sel_p.contains(t));}}if let Some(t)=pls.iter_mut().find(|p|p.name==pn){for f in &sel_p{if !t.tracks.contains(f){t.tracks.push(f.clone());}}}save_playlists(&s);println!("Moved {} track(s).",sel_p.len());} }
"copy"=>{ let ts=select(); if ts.is_empty(){return;} if let Some(pn)=sel_pl(&s){let sel_p:Vec<String>=ts.iter().filter_map(|&i|if i>=1&&i<=pl.len(){Some(pl[i-1].clone())}else{None}).collect();let mut pls=s.playlists.lock().unwrap();if let Some(t)=pls.iter_mut().find(|p|p.name==pn){for f in &sel_p{if !t.tracks.contains(f){t.tracks.push(f.clone());}}}save_playlists(&s);println!("Copied {} to '{}'.",sel_p.len(),pn);} }
_=>println!("t [info|delete|move|copy] [n|name]"), } }

fn print_help() { println!();
println!("  Playback:    play [n|name] / pause / stop / next / prev / seek <s> / vol <0-100>");
println!("  Mode:        mode [normal|repeat-one|repeat-all|shuffle]");
println!("  Library:     open dir / list [page] / info / t [n|name] / t delete|move|copy");
println!("  Playlists:   pl create|delete|list|switch|info / cd <name> / import");
println!("  Display:     bar [width|char] / lyric [t|f|next] / audio <normal|asio> / devices");
println!("  System:      clear / help / quit");
println!(); }
