# AGENTS.md

This file provides guidance for AI agents working in this repository.

## Build Commands

```bash
cargo check           # Rust typecheck
cargo test            # Rust unit tests
cargo build           # Dev build (binary in target/debug/musicli)
cargo build --release # Release build (binary in target/release/musicli)
cargo clippy          # Linter
```

Package manager / toolchain: **Cargo / Rust**. There is no Node.js / pnpm / frontend build anymore.

## Architecture

**MusiCLI v4.0** is a pure Rust terminal music player, interactive CLI REPL, and audio streaming server.

### Module Layout

```
src/
  main.rs           # Entry: CLI flag parsing, HTTP server start, launch REPL or headless
  lib.rs            # Library root, exports audio, core, server, etc.
  lrc_parser.rs     # LRC parsing + timestamp binary search
  server_state.rs   # Shared ServerState (audio engine, playlists, current index, play mode)
  core/             # Business logic (no framework coupling)
    files.rs        #   FS traversal, config paths, audio file validation
    metadata.rs     #   Audio metadata extraction (lofty)
    lyrics.rs       #   LRC search, offset read/write
    playlist.rs     #   Named playlist CRUD (atomic writes)
    search.rs       #   In-memory fuzzy track and tag search
    tags.rs         #   Track tagging (JSON sidecar in config/tags.json)
  audio/            # Audio engine (Symphonia → cpal)
    mod.rs          #   AudioMode enum
    engine.rs       #   AudioEngine, lock-free ring buffer, pause/resume
    decoder.rs      #   Symphonia decode loop + format conversion
    output.rs       #   cpal output stream
    resampler.rs    #   rubato sample rate conversion
  server/
    http.rs         # axum HTTP REST API & WebUI static file handlers
    live.rs         # Real-time PCM WAV live stream for /stream?current=true
    repl.rs         # Interactive Rustyline terminal REPL with live lyrics
assets/             # Built-in WebUI static files embedded via include_str! / include_bytes!
  index.html        #   Default Listen WebUI
  musicli.js        #   Listen WebUI client script
  pocket.html       #   Pocket Player mobile PWA WebUI
  sakura.html       #   Sakura Player LocalPlay (LP) WebUI
```

## Running & CLI Flags

```bash
cargo run                       # Interactive REPL mode (default)
cargo run -- --remote           # Headless background server mode
cargo run -- --port 3000        # Bind HTTP API to specific port (default: auto 52013+)
cargo run -- --token <SECRET>   # Enable bearer token auth for HTTP API
cargo run -- --music-folder <P> # Specify music folder path
```
The `musicli` binary serves both interactive and headless:
- `cargo run` (no flags) → Interactive terminal REPL with live lyrics
- `cargo run -- --remote` → Headless background HTTP API server
- `cargo run -- --port 3000` → Bind specific port

### `/pocket` WebUI has its own password, config, and asset set

The Pocket player is served from `server/http.rs::pocket_webui_handler`, separate from `/listen`:

- **Password** lives in `ServerState.pocket_password` (runtime) + `{music_folder}/config/pocket.json` (persisted, shape: `{ password, webui }`). Set via REPL `pocket pw <password>`. It's independent of `--token`/`api_token`; a valid session is an HttpOnly cookie holding `sha256(password)`. When switching music folders the password must be reloaded (`set_music_folder` clears then `load_pocket_config`s).
- **Custom UIs** go in `{music_folder}/Listen_WebUI/Pocket/` (their own subfolder — they must NOT appear in `listen ui`).
- **Default UI** is embedded from `assets/pocket.html` + `pocket-manifest.webmanifest` + `pocket-sw.js` + 3 icons.

### Tags are sidecar JSON keyed by basename

Track tags live in `{music_folder}/config/tags.json`, keyed by the file **basename** (like `lrc/offsets.json`), not the full path — tags survive file moves. Audio file metadata is never written. CRUD lives in `src/core/tags.rs`; the `/search?tag=` filter and `/tags` endpoints read the same file.

- `Kimi写的一起听WebUI/` — User's custom WebUI skins and templates library (always preserved).

### Testing Notes

- Rust tests: `cargo test` (all 29 tests covering time formatting, playlist navigation, lyrics parsing, tag persistence, metadata reading, search, and banner).
- Manual smoke test: `cargo run`, run `open <dir>`, `play`, `pause`, `lyric`, `mode`, `status`, `lp`.

## Maintenance

- **API.md** — If you add or change HTTP endpoints, update the API doc.
- **README.md** — If you add/remove/rename commands, update the command reference.
- **AGENTS.md** — If you discover a new gotcha, add it here.

## Cache Efficiency (for AI agents)

To minimize context roundtrips and maximize context caching hit rate:

### Batch reads first, then batch writes
- **Round 1**: parallel-read **all** files needed (not "read 1 file → edit → read next file").
- **Round 2**: parallel-apply **all** edits.
- **Round 3**: parallel-run **all** verifications (lint, clippy, tests).

### Run diagnostics in parallel with reads
- `cargo clippy`, `cargo test`, `cargo check` can all run in the same round as file reads.
- Never: "run clippy → see errors → read file → edit → run clippy again". This bounces between rounds N times instead of 3.

### Anti-pattern (what burns cache)
```
bash: cargo clippy                 # round 1
read: file1.rs                     # round 2
edit: file1.rs                     # round 3
read: file2.rs                     # round 4
edit: file2.rs                     # round 5
bash: cargo clippy                 # round 6
```
Each round is a separate context computation — cache miss × 6.

### Correct pattern
```
bash: cargo clippy                  ─┐
read: [all files with errors]       ─┤ round 1 (parallel)
bash: cargo check                   ─┘
edit: [all edits]                    ─ round 2 (parallel)
bash: cargo clippy + cargo test      ─ round 3 (parallel verify)
```
At most 3 rounds for any batch fix.
