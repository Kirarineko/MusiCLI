# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run Commands

```bash
pnpm dev              # Vite dev server only (browser, no Electron IPC)
pnpm start            # Full Electron app: starts Vite + launches Electron
pnpm build            # TypeScript check + production build to dist/
pnpm lint             # ESLint
pnpm electron:build:win  # Build Windows installer
```

Package manager is **pnpm**. The `package.json` does NOT have `"type": "module"` — Electron main/preload use CommonJS (`require`), while the renderer (React/TS) is bundled by Vite as ESM.

## Architecture Overview

**Electron** desktop music player with a **pseudo-CLI terminal aesthetic**. User types commands into an input line at the bottom; output scrolls in a terminal-like area above. A now-playing bar sits between them. Supports floating lyrics in a separate transparent window.

### Process Model

- **Main process** (`electron/main.js`): CJS. Creates a frameless BrowserWindow. Exposes ~15 IPC handlers for file dialogs, music-metadata parsing, directory listing, file I/O, window controls. Uses `webSecurity: false` only in dev mode (because pages served from `http://localhost` can't load `file://` audio sources — cross-origin). Production loads from `dist/index.html` which is same-origin with audio files.
- **Preload** (`electron/preload.js`): CJS. Bridges IPC to renderer via `contextBridge.exposeInMainWorld('musicPlayer', { ... })`. All renderer ↔ main communication goes through this single surface.
- **Renderer** (`src/`): React 19 + TypeScript, bundled by Vite. No Node.js integration (`contextIsolation: true`, `nodeIntegration: false`).

### Renderer Component Tree & Context Hierarchy

```
App
├── SettingsProvider          (CSS variables, themes, language)
│   └── PlaylistProvider      (named playlists, syncs to player)
│       └── PlayerProvider    (audio element, playback state, lyrics)
│           └── TerminalProvider (output lines, select/imode state, commands)
│               └── AppInitializer (wires PlayerContext → PlaylistContext)
│                   ├── BackgroundLayer
│                   ├── TitleBar
│                   ├── Terminal        (renders lines + banner)
│                   ├── NowPlaying      (track info, progress bar, volume)
│                   ├── SelectList      (fuzzy select / interactive multi-select)
│                   └── InputLine       (command input, history, keybindings)
```

The nesting order matters: `PlaylistProvider` wraps `PlayerProvider` because playlist operations (add/remove/switch tracks) must sync into the player's live playlist array.

### Context Cross-Communication

`PlayerContext` and `PlaylistContext` are separate contexts but must stay in sync. The `PlaylistContext` exposes `registerPlayerSync(sync: PlayerSync)` — `AppInitializer` calls this once to inject player functions (`addToPlaylist`, `clearPlaylist`, `getPlaylist`) into the playlist context. Then `addTracksToCurrent()`, `replaceCurrentTracks()`, `switchPlaylist()`, and `deletePlaylist()` all automatically sync changes to the active player playlist.

### Command System

`src/commands/registry.ts` — Simple flat command registry. `register(name, aliases, handler, helpKey)` stores commands keyed by lowercase name/alias. `getCommand(name)` looks up and returns `{ handler }`.

`src/commands/handlers.ts` — All ~30 commands defined here. Uses a module-level `_ctx: CommandContext` variable set by `setCommandContext()`. The `CommandContext` interface bundles functions from all four contexts so command handlers have unified access to player, playlists, terminal output, settings, and themes.

`src/components/InputLine.tsx` — Parses input, looks up commands via `getCommand()`, calls `cmd.handler(args)`. Rebuilds and sets `CommandContext` before each execution to ensure fresh state references.

### IPC Return Types

All IPC handlers that can fail return `T | { error: string }`. A local `hasError(obj)` helper (checks `typeof obj === 'object' && 'error' in obj`) discriminates the union. **Do not** use raw `'error' in result` — TypeScript 6 requires `object` type for the `in` operator.

### Interactive Modes

Two selection UIs managed by `TerminalContext`:

1. **Fuzzy select** (`selectMode`): After `play <name>` with multiple matches. Arrow keys + Enter to pick, Esc to cancel. Mouse wheel supported via `SelectList` component.
2. **Interactive multi-select** (`imode`): For `import` and `track pl` commands. Space toggles selection, Enter confirms, Esc cancels. Typing filters the list.

Filter input uses native browser text editing: `onInput` reads `inputRef.current.value` and calls `terminal.updateFilter()`. **Do not** intercept Backspace/Delete or printable characters with `preventDefault()` — let the browser handle text editing, only intercept special keys (arrows, space, enter, escape) that change semantics.

### Settings & Persistence

- `musiccli-settings` — Appearance (colors, fonts, background, blur, progress bar), volume, music folder, lyrics state. Applied to `:root` CSS variables via `applyCssVars()`.
- `musiccli-themes` — Named themes (built-in: "dark", "Claude Desktop"). Support export/import as JSON with embedded base64 image data.
- `musiccli-playlists` + `musiccli-current-pl` — Named playlist storage. **Loaded synchronously** in `useState` initializer (not `useEffect`) so data is available before any child effect runs.
- `musiccli-lang` — Language preference (en/zh/ja).

Built-in themes live in `SettingsContext.tsx` as `BUILTIN_THEMES`. User themes merge into the same localStorage key.

### Floating Lyrics Window

A second BrowserWindow (`transparent: true, alwaysOnTop: true`) loads the same Vite app with hash `#/lyrics`. The `App` component checks `window.location.hash` and renders `FloatingLyrics` component instead of the main UI. Theme sync happens via `sendLyricsTheme()` IPC.

### Dev vs Production

| Aspect | Dev (`npm start`) | Production |
|--------|-------------------|------------|
| Renderer source | Vite dev server (localhost:5173) | `dist/index.html` (built) |
| Audio URLs | `file:///` (needs `webSecurity: false`) | `file:///` (same-origin, secure) |
| DevTools | Auto-open | Closed |

### Key Lessons Learned

- **Don't fight the browser for text input.** Use `onInput` to read the result; only intercept keys that need semantic override (arrows, space, enter, escape).
- **Load persisted state in `useState` initializer**, not `useEffect`. Otherwise child effects run before data is available.
- **Use `useRef` for mutable state that must be read synchronously** across context boundaries (e.g., `playlistRef` in PlayerContext). Expose getter functions alongside snapshot values.
- **Combine related state updates into single functions** that take the new value as a parameter (e.g., `updateFilter(newFilter)`) rather than two-step `setX()` + `calcY()` which suffers from batch timing.
- **Standalone helper functions beat memoized context methods** for derived state. `filterItems(items, query)` can't have stale closures because it takes everything as arguments.
- **IPC return type is `T | { error: string }`**, not `T`. Always check with `hasError()` before using.
