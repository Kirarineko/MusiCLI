# Task 2.8 Report: Slim down http.rs and repl.rs to use core::

**Status: COMPLETE**

## Changes Summary

### http.rs (`src-tauri/src/server/http.rs`)

- **`import_sync` handler** (lines 536-552): Replaced inline JSON merge logic (reading/writing playlists.json directly, merging JSON objects, writing back) with calls to `core::playlist::create_playlist`. Each incoming playlist is created via the core API; duplicate errors are silently skipped.

### repl.rs (`src-tauri/src/server/repl.rs`)

- **`load_lyrics`**: `lrc_cmd::find_lrc_sync` → `core::lyrics::find_lrc`; `fs_cmd::read_file_sync` → `core::files::read_file`
- **`load_folder`**: `fs_cmd::list_audio_files_sync` → `core::files::list_audio_files`
- **`info`**: `metadata_cmd::read_metadata_sync` → `core::metadata::read_metadata` (adjusted duration field to `Option<f64>`)
- **`track` subcommands**: `metadata_cmd::read_metadata_sync` → `core::metadata::read_metadata`
- **`import`**: `fs_cmd::list_audio_files_sync` → `core::files::list_audio_files`; inline playlist track insertion → `core::playlist::add_tracks`
- **Playlist cache system**:
  - Added `refresh_playlists_cache()` — loads from `core::playlist::list_playlists` + `get_playlist` + `get_current_playlist_name`
  - `load_playlists` now delegates to `refresh_playlists_cache`
  - `save_playlists` now writes in `core::playlist`-compatible JSON format (`playlists`/`current` keys) instead of legacy config format (`pls`/`cur`)
  - `sync_current_playlist` now uses `core::playlist::get_playlist`
- **`pl create`**: Uses `core::playlist::create_playlist` + cache refresh
- **`pl delete`**: Uses `core::playlist::delete_playlist` + cache refresh
- **`pl switch`**: Uses `core::playlist::switch_playlist` + cache refresh
- **`cd`**: Uses `core::playlist::switch_playlist` + cache refresh
- **`now_iso`**: Removed (unused after playlist migration; core uses chrono internally)

## Verification

| Command | Result |
|---------|--------|
| `cargo check --features server` | PASS (warnings only) |
| `cargo check --features gui` | PASS |
| `cargo check --features gui,server` | PASS |
| `cargo check` (no features) | PASS |
| `pnpm build` | PASS |

`cargo check --features asio,server` fails with a pre-existing `cpal::HostId::Asio` error unrelated to this refactor.

## Commit

```
refactor: slim http.rs and repl.rs to use core::*
```

## Concerns

- **Format migration**: The legacy config-based playlist format (`pls`/`cur` keys) is replaced with `core::playlist`-compatible format (`playlists`/`current` keys) in `playlists.json`. Existing REPL users lose their named playlists on first run after this change. The core module will create a fresh "Default" playlist.
- **`save_playlists` writes directly**: The REPL's `save_playlists` function now writes `playlists.json` directly (in core format) rather than through `core::playlist::*` functions. This is necessary because core doesn't expose a "replace all tracks" or "batch modify" API. Consistency with core reads is maintained.
- **`track delete/move/copy`**: These REPL subcommands still modify the in-memory `NamedPlaylist` cache and persist via `save_playlists`. They do not use `core::playlist::*` for individual operations because core lacks per-track removal and track-moving APIs beyond `sync_track_playlists` (which removes tracks from all playlists).
