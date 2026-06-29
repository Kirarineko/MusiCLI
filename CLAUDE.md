# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run Commands

```bash
pnpm dev              # Vite dev server only (browser, no native IPC)
pnpm tauri dev        # Full Tauri app: starts Vite + launches Tauri window
pnpm build            # TypeScript check + production build to dist/
pnpm tauri build      # Build release binary
pnpm lint             # ESLint
```

Package manager is **pnpm**.

### Prerequisites

- **Rust toolchain** — Install via [rustup.rs](https://rustup.rs)
- **LLVM/Clang** — For ASIO SDK build: `winget install LLVM.LLVM`

## Architecture Overview

**Tauri v2** desktop music player with a **pseudo-CLI terminal aesthetic**. User types commands into an input line at the bottom; output scrolls in a terminal-like area above. A now-playing bar sits between them. Supports floating lyrics in a separate transparent window.

### Process Model

- **Rust backend** (`src-tauri/src/`): All IPC commands, audio engine, file I/O, metadata parsing, ZIP, LRC, config.
- **Frontend** (`src/`): React 19 + TypeScript, bundled by Vite. Communicates with Rust via `bridge/tauri.ts` using `@tauri-apps/api/core` invoke().

### Renderer Component Tree & Context Hierarchy

```
App
├── SettingsProvider          (CSS variables, themes, language)
│   └── PlaylistProvider      (named playlists, syncs to player)
│       └── PlayerProvider    (Rust audio engine, playback state, lyrics)
│           └── TerminalProvider (output lines, select/imode/seek states, commands)
│               └── AppInitializer (wires contexts together, startup sync)
│                   ├── BackgroundLayer
│                   ├── TitleBar
│                   ├── Terminal        (renders lines + banner)
│                   ├── NowPlaying      (track info, progress bar, volume)
│                   ├── SelectList      (fuzzy select / interactive multi-select)
│                   └── InputLine       (command input, history, keybindings)
```

### Audio Engine

All audio playback goes through Rust (`src-tauri/src/audio/`):

- **decoder.rs** — Symphonia-based decoder thread. Reads audio file → decodes to f32 PCM → writes to ring buffer.
- **output.rs** — cpal output stream. Reads from ring buffer → sends to audio device.
- **engine.rs** — State machine coordinating decoder, output, seek, volume.
- **Two modes:**
  - `audio mode normal` — cpal WASAPI Shared (default, system mixer)
  - `audio mode asio` — cpal ASIO (exclusive, requires ASIO drivers)

Frontend polls `get_position()` every 100ms for progress updates and lyrics sync.

### Bridge Pattern

All frontend↔backend communication goes through `src/bridge/index.ts` (IBridge interface).
- `src/bridge/tauri.ts` — Tauri implementation using invoke() and plugin APIs
- `src/bridge/http.ts` — fetch() wrapper for REST API (browser dev mode / external)
- `src/bridge/hybrid.ts` — auto-detects Tauri vs browser; in Tauri context routes only audio engine methods via HTTP when the server is running
- `initBridge()` auto-detects environment and loads the appropriate bridge

### Command System

`src/commands/registry.ts` — Flat command registry. `register(name, aliases, handler, helpKey)` stores commands keyed by lowercase name/alias.

`src/commands/handlers/` — All commands defined here, split by concern:
- `index.ts` — `CommandContext` interface, shared helpers, `registerAllCommands()`
- `playback.ts`, `playlist.ts`, `appearance.ts`, `lyrics.ts`, `sync.ts`, `system.ts`

Uses module-level `_ctx: CommandContext` set by `setCommandContext()`. The `CommandContext` bundles functions from all four contexts.

**CRITICAL**: `registerAllCommands()` is called at **module level** (not in `useEffect`). If called in `useEffect`, Vite HMR resets the module-level `commands` object but the effect never re-runs, silently losing all commands.

### IPC Return Types

All IPC handlers that can fail return `T | { error: string }`. Use `hasError(obj)` helper: `typeof obj === 'object' && obj !== null && 'error' in obj`. **Do not** use raw `'error' in result` — TypeScript 6 requires `object` type for `in`.

### Interactive Modes

1. **Fuzzy select** (`selectMode`): After `play <name>` with multiple matches. Arrow keys + Enter, Esc, mouse wheel.
2. **Interactive multi-select** (`imode`): For `import` and `track pl`. Space toggles, Enter confirms, Esc cancels, typing filters.
3. **Seek mode** (`seekMode`): `seek` with no args. Left/Right arrows seek by configurable step. Any other key exits.

Filter input: `onInput` reads `inputRef.current.value` → `updateFilter()`. **Never** intercept Backspace/Delete/printable keys with `preventDefault()`. Only intercept arrows, space, enter, escape.

### Settings & Persistence

**Config files** are stored as JSON in `{musicFolder}/config/`:
- `settings.json` — All AppSettings (colors, fonts, lyrics, etc.)
- `themes.json` — Named themes
- `playlists.json` — `{ playlists: Record<string, Playlist>, current: string }`
- `lang.json` — Language code (`"en"` | `"zh"` | `"ja"`)

**Architecture**: `src/configStore.ts` is the single persistence layer.
- Module-level in-memory cache populated synchronously from localStorage at import time
- `initConfig()` (called once in AppInitializer useEffect) reads files asynchronously, updates cache + localStorage
- All save functions (`saveSettings`, `saveThemes`, `savePlaylists`, `saveLang`) write to BOTH file AND localStorage
- `initConfig()` is **read-only** — it never writes to files to avoid overwriting manual edits
- `musicFolder` is the only bootstrap key stored solely in localStorage (`musicli-musicfolder`)
- Synchronous getters (`getSettings()`, `getThemes()`, `getPlaylists()`, `getLang()`) read from in-memory cache for backward compat with existing sync call sites

**Startup order** (critical for correctness):
1. Module load: configStore cache ← localStorage (sync)
2. React render
3. AppInitializer useEffect: `initBridge()` → `initConfig()` reads files → updates cache → applyCssVars → `playlists.reloadFromStore()` → restore lyrics
4. All writes (saves) happen AFTER files are loaded, so manual file edits survive restart

### Floating Lyrics Window

Separate Tauri WebviewWindow (`transparent: true, alwaysOnTop: true`), loads same app with `#/lyrics` hash. Fixed width 600px, auto-height via `ResizeObserver` + IPC `lyrics_auto_size`.

**Theme sync**: Sent via `send_lyrics_theme` IPC → Rust stores in `LAST_LYRICS_THEME` mutex → emits to lyrics window via event system.

### Key Lessons Learned

- **Don't fight the browser for text input.** Use `onInput`, only intercept semantic keys.
- **Load persisted state synchronously** in `useState` initializer or module level, not `useEffect`.
- **Combine related state updates into single functions** (e.g. `updateFilter(newFilter)` vs `setX()` + `calcY()`).
- **Standalone helper functions > memoized context methods** for derived state (e.g. `filterItems(items, query)`).
- **Module-level registration** for commands — survives HMR.
- **200ms delay sync** is more reliable than complex multi-source sync for config that must survive restarts.
- **`var()` in CSS can only have ONE fallback** — comma-separated values break. Define defaults on `:root` instead.
- **React StrictMode double-invokes nested state setters** — use refs instead of `setOuter(prev => { setInner(...) })`.
- **Context values created in render are always latest** but callbacks close over stale state — pass values as arguments, use refs.
