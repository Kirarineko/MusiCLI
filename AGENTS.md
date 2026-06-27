# AGENTS.md

This file provides guidance for AI agents working in this repository.

## Build Commands

```bash
pnpm dev              # Vite dev server only (no native IPC)
pnpm tauri dev        # Full app: Vite + Tauri window
pnpm build            # TypeScript check + Vite production build
pnpm typecheck        # Standalone typecheck (tsc -b), no build
pnpm lint             # ESLint
pnpm test             # Vitest (frontend unit tests)
pnpm clean            # Remove dist/
cargo check           # Rust typecheck only (cd src-tauri first)
cargo test            # Rust unit tests (cd src-tauri first)
```

Package manager: **pnpm**. Never `npm install` or `yarn`.

## Architecture

**Tauri v2** desktop music player — pseudo-CLI terminal UI. React 19 frontend, Rust backend (Symphonia + cpal).

### Component Tree

```
SettingsProvider → PlaylistProvider → PlayerProvider → TerminalProvider → AppInitializer
                                                                               ├── InputLine (commands, keybindings)
                                                                               ├── Terminal / SelectList / NowPlaying
                                                                               └── BackgroundLayer / TitleBar
```

### Rust Module Layout

```
src-tauri/src/
  main.rs           # Entry: starts HTTP server → run_gui() or REPL
  lib.rs            # Tauri builder + invoke_handler
  commands.rs       # Tauri command wrappers → calls core::
  core/             # Shared business logic (no framework coupling)
    files.rs        #   FS, config paths, ZIP, file I/O
    metadata.rs     #   Audio metadata (lofty)
    lyrics.rs       #   LRC search, parse, offset I/O
    playlist.rs     #   Named playlist CRUD
  audio/            # Audio engine (Symphonia → cpal)
  server/
    http.rs         # axum HTTP API (always compiled)
    repl.rs         # CLI REPL (requires --features server)
```

### Frontend Command Handlers

Commands split by concern into `src/commands/handlers/`:
- `index.ts` — `CommandContext` interface, shared helpers (`playTrack`, `readMetadata`, etc.)
- `playback.ts`, `playlist.ts`, `appearance.ts`, `lyrics.ts`, `sync.ts`, `system.ts`

Commands register at **module level** (not in `useEffect`) to survive Vite HMR.

### Bridge: Tauri invoke (primary), HTTP (external)

- GUI communicates via `@tauri-apps/api/core` invoke → Tauri commands in `lib.rs`
- HTTP server runs on random `127.0.0.1` port for external API access
- The HTTP server and GUI use **independent** audio engines — playing via one does not affect the other
- `bridge/tauri.ts` — full bridge with invoke calls for all data operations
- `bridge/http.ts` — fetch() wrapper for REST API
- `bridge/hybrid.ts` — auto-detects Tauri vs browser, prefers invoke in Tauri context

## Gotchas

### No `gui` feature

`tauri` and `tauri-plugin-dialog` are **non-optional** dependencies. There is no `gui` Cargo feature. Tauri is always compiled.

### `server` feature is REPL-only

`axum` and `tokio` are always compiled (HTTP server always available). The `server` feature only gates `rustyline` for the CLI REPL. `server start/stop/status` commands work in GUI mode without any feature flag.

### Config persistence: raw lang string

`lang.json` stores the raw language code (`"zh"`, `"en"`, `"ja"`) — **not** JSON-encoded. The `loadFromLs` helper in `configStore.ts` has special handling for `LS_KEYS.lang` that skips `JSON.parse`. If modifying config loading, keep this in mind — `JSON.parse('zh')` throws.

### SettingsContext values are React snapshots

`settings.settings` (from `useSettings()`) is a context value computed at render time. If a module-level `_settings` is mutated without triggering a re-render, the context value is **stale**. Commands that need the latest value immediately after `saveSettings()` should read from `getStoredSettings()` (module-level helper) instead.

### SafeHtml regex must process tags in one pass

The `SafeHtml` component in `src/components/SafeHtml.tsx` escapes all HTML then unescapes whitelisted tags. The regex replacement must handle opening tag + attributes + closing in a single pass per tag. Splitting it into multiple replacements (first `&lt;div` → `<div`, then `&gt;` → `>` separately) breaks. See the current implementation for the working pattern.

### `showMetadata` uses `formatTime()`

The shared helper in `handlers/index.ts` calls `formatTime(meta.duration)` — not manual `Math.floor/60 + padStart` math.

### `hasError` is in `utils/guards.ts`

Single source of truth. Do not redefine it inline. Import from `'../../utils/guards'`.

### `DEFAULT_SETTINGS` lives in `configStore.ts`

`SettingsContext.tsx` imports it — no duplicate definition. Same for `BUILTIN_THEMES` and `SHADOW_PRESETS`.

### Loading spinner

The app binds to a random port via `TcpListener::bind("127.0.0.1:0")` to discover the port, then binds again inside the tokio runtime. Do not use `tokio::net::TcpListener::from_std()` — it causes Linux socket errors.

### Cargo features for `tauri dev`

`pnpm tauri dev` runs `cargo run --no-default-features`. Since tauri is non-optional, this works without any `--features` flags.

## Testing Notes

- Frontend unit tests: `vitest` (config auto-detected). Test files in `src/utils/__tests__/`.
- Rust tests: `cargo test`. Core module tests verify playlist CRUD, metadata reading, LRC parsing, etc.
- Manual smoke test after changes: play, pause, seek, volume, playlist switch, import/export, theme, lyrics, server status.
