# Code Quality Overhaul — Design Spec

**Date:** 2026-06-27
**Status:** Approved
**Author:** AI-assisted refactoring

---

## 1. Motivation

The codebase has accumulated technical debt as features were added organically:

- **Three parallel implementations** of the same logic: Tauri IPC commands, HTTP REST API, and CLI REPL each independently implement playlist management, metadata reading, lyrics parsing, and file operations.
- **Oversized files**: `handlers.ts` (1358 lines), `PlayerContext.tsx` (546 lines), `repl.rs` (335 lines extreme density).
- **Silent error swallowing** and **dead code** scattered across both frontend and backend.
- **Architectural issues**: Ref/State dualism in PlayerContext, circular dependency between PlaylistContext and PlayerContext, `dangerouslySetInnerHTML` in terminal rendering.
- **Tooling gaps**: Missing `strict` TypeScript mode, no CI/CD, redundant dependencies.

## 2. Design Decision: REST-First Backend

**The backend (Rust) is now the canonical server.** All three interfaces communicate via the same mechanism:

```
Frontend GUI ──fetch(localhost:PORT)──┐
HTTP Client ──fetch(localhost:PORT)───┤──→ HTTP handlers ──→ core layer ──→ AudioEngine
CLI REPL ──direct call───────────────┘
```

- HTTP server starts in ALL modes (GUI, server, CLI).
- Frontend replaces `invoke()` with `fetch()` for all data operations.
- Only Tauri-specific plugins (dialog, window events) keep using `invoke()`.
- Backend can run independently: `./musiCLI --port 3000`.

## 3. Architecture Target

### 3.1 Final Rust Module Structure

```
src-tauri/src/
├── main.rs                      # Entry: start HTTP server, then GUI/CLI
├── lib.rs                       # Module declarations, GUI builder (if feature=gui)
├── server_state.rs              # Simplified shared state
├── core/                        # NEW: shared business logic (no framework coupling)
│   ├── mod.rs
│   ├── playlist.rs              # CRUD, import, search audio files
│   ├── lyrics.rs                # LRC file search, parse, offset read/write
│   ├── metadata.rs              # Audio file metadata (lofty wrapper)
│   └── files.rs                 # ZIP, config paths, file listing
├── audio/                       # (unchanged) AudioEngine, decoder, output, resampler
│   ├── mod.rs                   # Tauri commands (play/pause/etc remain invoke for now)
│   ├── engine.rs
│   ├── decoder.rs
│   ├── output.rs
│   └── resampler.rs
├── server/
│   ├── mod.rs
│   ├── http.rs                  # axum routes, call core::*
│   └── repl.rs                  # rustyline REPL, call core::*
├── lrc_parser.rs                # (unchanged) pure parsing utility
├── window_cmd.rs                # Only non-HTTP Tauri commands
├── dialog_cmd.rs                # File dialogs
└── lyrics_cmd.rs                # Floating lyrics theme sync
```

### 3.2 Final Frontend Structure

```
src/
├── main.tsx
├── App.tsx                      # Simplified init: wait for HTTP server → start
├── index.css
├── types/
│   └── index.ts
├── constants/                   # NEW: extracted from SettingsContext
│   └── themes.ts                # SHADOW_PRESETS, BUILTIN_THEMES
├── utils/
│   ├── format.ts                # formatTime, escapeHtml, getFileName
│   ├── color.ts                 # parseColor, formatColor, darken
│   ├── fuzzy.ts                 # fuzzySearch
│   ├── lrc.ts                   # parseLRC, getCurrentLineIdx
│   ├── guards.ts                # NEW: hasError() — single source of truth
│   └── css.ts                   # NEW: applyCssVars (moved from SettingsContext)
├── configStore.ts               # DEFAULT_SETTINGS as single source (export for SettingsContext)
├── bridge/
│   ├── index.ts                 # IBridge interface
│   ├── http.ts                  # NEW: all data calls via fetch()
│   ├── tauri.ts                 # Reduced: dialog, window, lyrics events only
│   └── hybrid.ts                # NEW: combines http + tauri → IBridge
├── commands/
│   ├── registry.ts
│   ├── completions.ts
│   ├── helpLayout.ts            # NEW: extracted from TerminalContext.printHelp
│   ├── handlers/
│   │   ├── index.ts             # registerAllCommands() + CommandContext
│   │   ├── playback.ts          # play, pause, stop, next, prev, seek, mode, vol, audio
│   │   ├── playlist.ts          # open, cd, import, list, pl, track
│   │   ├── appearance.ts        # color, colors, bg, blur, font, set, bar
│   │   ├── lyrics.ts            # lyric
│   │   ├── sync.ts              # sync playlist/theme
│   │   └── system.ts            # lang, help, clear, reset, quit
├── contexts/
│   ├── SettingsContext.tsx       # Simplified: imports defaults from configStore
│   ├── PlaylistContext.tsx       # Simplified: unidirectional dependency
│   ├── PlayerContext.tsx         # Simplified: useState for playlist, lyrics extracted
│   └── TerminalContext.tsx       # Simplified: printHelp delegated to helpLayout
├── components/
│   ├── BackgroundLayer.tsx
│   ├── TitleBar.tsx
│   ├── Terminal.tsx
│   ├── NowPlaying.tsx
│   ├── InputLine.tsx            # Simplified: key handlers extracted
│   ├── SelectList.tsx
│   ├── SafeHtml.tsx             # NEW: whitelist-based HTML rendering
│   └── FloatingLyrics.tsx
└── i18n/
    ├── index.ts
    └── translations.ts          # Dead keys removed, helpAudio added
```

## 4. Phase-by-Phase Plan

### Phase 1: Frontend Cleanup (Low Risk)

**Scope:** 15 files, all equivalent transformations.

| Action | Files | Details |
|--------|-------|---------|
| Split handlers.ts → handlers/*.ts | `handlers.ts` deleted, 7 new files | Each ~100-200 lines |
| Merge track/track pl handlers | `handlers/playlist.ts` | `track delete` calls `track pl delete` internally |
| Extract `playTrack(path, ctx)` helper | `handlers/playback.ts` | Eliminates 7x duplicate `readMetadata + print + loadLRC` |
| Extract `hasError()` to utils/guards.ts | `utils/guards.ts` (new), `handlers/index.ts`, `PlayerContext.tsx`, `configStore.ts` | Single source of truth |
| Move `applyCssVars` to utils/css.ts | `utils/css.ts` (new), `SettingsContext.tsx` | Pure DOM utility |
| Move `SHADOW_PRESETS` to constants/themes.ts | `constants/themes.ts` (new), `SettingsContext.tsx` | Data constant |
| Remove dead code: parseCommand, isValidHexOrRgb, selectSaveDir, dead translations | `format.ts`, `color.ts`, `bridge/tauri.ts`, `translations.ts` | 4 removals + 3 translation keys |
| Extract printHelp → commands/helpLayout.ts | `commands/helpLayout.ts` (new), `TerminalContext.tsx` | Data-driven help layout |
| Dedup DEFAULT_SETTINGS, BUILTIN_THEMES | `configStore.ts` exports, `SettingsContext.tsx` imports | Single source |
| Fix formatTime usage in showMetadata | `handlers/appearance.ts` | Use `formatTime()` instead of manual math |

**Verification:** `pnpm typecheck`, `pnpm build`, `pnpm lint`. Manual smoke test.

### Phase 2: Rust Core Layer + REST Frontend (Medium Risk)

**Scope:** ~15 Rust files, ~5 frontend files.

#### 2.1 New core/ modules

| Module | Source of truth extracted from |
|--------|-------------------------------|
| `core/playlist.rs` | `repl.rs` + `http.rs` playlist handlers + `fs_cmd.rs` list_audio_files |
| `core/lyrics.rs` | `lrc_cmd.rs` + `repl.rs` lyric command + `lrc_parser.rs` |
| `core/metadata.rs` | `metadata_cmd.rs` |
| `core/files.rs` | `fs_cmd.rs` + `zip_cmd.rs` + config path helpers |

#### 2.2 HTTP server always-on

- `main.rs`: Start HTTP server before GUI window. Pass port via env var or Tauri state.
- For `--server` mode: same code, different bind options.
- For `--cli` mode: server optional (REPL calls core directly).

#### 2.3 HTTP API gap fill

| Route | Method | Purpose |
|-------|--------|---------|
| `/config` | GET | Read config value by key |
| `/config` | PUT | Write config |
| `/lyrics` | GET | Search LRC file for audio path |
| `/lyrics/offsets` | GET | Read LRC offsets |
| `/lyrics/offsets` | POST | Write LRC offset |
| `/sync/export` | POST | Export playlist(s) as ZIP |
| `/sync/import` | POST | Import ZIP, merge playlists |
| `/files/list` | GET | List audio files in directory |
| `/files/read` | GET | Read file as base64 |

#### 2.4 Frontend bridge changes

- New `bridge/http.ts`: `fetch()` wrapper with retry, error handling, port management.
- New `bridge/hybrid.ts`: combines `http.ts` and `tauri.ts`.
- `bridge/tauri.ts`: Reduced to `openFileDialog()`, `saveFileDialog()`, `sendLyricsTheme()`, `autoSizeLyrics()`.
- Handlers.ts unchanged (IBridge stays same interface).

#### 2.5 Deleted files

- `config_cmd.rs` → HTTP handlers call core/files
- `fs_cmd.rs` → HTTP handlers call core/files
- `lrc_cmd.rs` → HTTP handlers call core/lyrics
- `metadata_cmd.rs` → HTTP handlers call core/metadata
- `zip_cmd.rs` → HTTP handlers call core/files

#### 2.6 Bug fixes in this phase

- `lrc_cmd.rs:47`: `unwrap_or()` → proper error propagation
- `metadata_cmd.rs`: Extract actual codec from lofty instead of hardcoded `"Unknown"`
- `engine.rs`: Expose `is_playing()` and `get_volume()` as HTTP endpoints
- Symphonia features: Add `flac`, `vorbis`, `pcm`, `wav`

**Verification:** `cargo check`, `cargo clippy`, `cargo test`. `curl` all endpoints. GUI full test. CLI REPL test.

### Phase 3: Configuration & Tooling (Low Risk)

**Scope:** 8 config files.

| Action | Files |
|--------|-------|
| Add `"strict": true` to both tsconfigs | `tsconfig.app.json`, `tsconfig.node.json` |
| Add `noUnusedLocals: true`, `noUnusedParameters: true` to app tsconfig | `tsconfig.app.json` |
| Fix strict mode issues | Various .ts/.tsx |
| Remove `esbuild` from package.json devDeps | `package.json` |
| Delete `package-lock.json` | — |
| Delete `pnpm-workspace.yaml` (if empty after esbuild removal) | — |
| Add `typecheck` and `clean` scripts | `package.json` |
| Cargo.toml: tokio features slim down | `Cargo.toml` |
| Cargo.toml: remove chrono serde feature | `Cargo.toml` |
| Add `.github/workflows/ci.yml` | Lint + typecheck + build + cargo check + clippy + test |
| Clean `.gitignore` | Remove `nul`, Electron entries |
| Add `<link rel="icon">` to index.html | `index.html` |
| Unify `!` vs `!!` in vite.config.ts | `vite.config.ts` |

**Verification:** CI workflow green.

### Phase 4: Deep Architecture (Medium-High Risk)

**Scope:** ~4 context files, ~2 components.

#### 4.1 PlayerContext Ref/State cleanup

- `playlistRef` → `useState<AudioTrack[]>([])` with setter
- `currentIndexRef` → `useState<number>(0)`
- `isPlayingRef` → remove (already have `isPlaying` state)
- `lrcPathRef` → `useState<string>("")`
- Keep `durationRef`, `currentTimeRef`, `autoNextGuardRef` (performance-sensitive)
- Ensure `NowPlaying.tsx` reads correct playlist from context

#### 4.2 PlaylistContext ↔ PlayerContext decoupling

- Remove `PlayerSync` callback interface.
- PlayerContext reads playlists directly from configStore + PlaylistContext state.
- PlaylistContext no longer imports or calls PlayerContext methods.

#### 4.3 dangerouslySetInnerHTML safety

- Create `src/components/SafeHtml.tsx` component.
- Whitelist only known tags (`<cmd>`, `<kv>`, `<list>`) to pass as real HTML.
- Replace `dangerouslySetInnerHTML` in Terminal.tsx and SelectList.tsx.

#### 4.4 200ms delay → event-driven sync

- Replace 3 `setTimeout(200)` calls with `waitFor()` utility.
- `waitFor<T>(getter, timeout): Promise<T>` — polls getter every 20ms until returns non-null.

#### 4.5 Tests

- **Vitest**: `fuzzySearch`, `formatTime`, `escapeHtml`, `parseLRC`, `getCurrentLineIdx`, `hasError`
- **Rust test**: `core::playlist` CRUD, `lrc_parser::parse_lrc`, `core::lyrics` search

**Verification:** All tests pass + full manual regression.

## 5. Risk Assessment

| Phase | Risk | Mitigation |
|-------|------|------------|
| 1 | Low | Equivalent transformations, no behavior change. `pnpm typecheck` catches errors. |
| 2 | Medium | New core modules tested independently. HTTP API behavior verified with curl. Frontend bridge abstraction isolates changes. |
| 3 | Low | Config-only changes. CI validates. |
| 4 | Medium-High | Each sub-task independent. PlayerContext ref/state change riskiest — do last with extra manual testing. |

## 6. Out of Scope

- Adding new features (pure refactoring)
- Changing terminal UI/UX
- Adding a database (keep JSON file storage)
- Porting to another framework
- Performance optimization beyond incidental improvements from restructuring

## 7. Verification Summary

| Stage | Automated | Manual |
|-------|-----------|--------|
| Phase 1 | `pnpm typecheck`, `pnpm build`, `pnpm lint` | Smoke test: play, pause, seek, playlists, themes, import/export |
| Phase 2 | `cargo check`, `cargo clippy`, `cargo test`, `pnpm build` | `curl` all endpoints, GUI full test, CLI REPL test |
| Phase 3 | CI workflow (lint + typecheck + build + cargo check) | — |
| Phase 4 | `cargo test`, `pnpm test` (vitest) | Full manual regression |
