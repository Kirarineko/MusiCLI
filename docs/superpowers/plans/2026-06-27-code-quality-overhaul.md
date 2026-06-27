# Code Quality Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Comprehensively refactor the MusiCLI codebase — split oversized files, eliminate duplication, extract shared Rust core layer, replace Tauri invoke with REST for data operations, tighten toolchain, and fix architectural issues.

**Architecture:** Four sequential phases. Phase 1 cleans the TypeScript frontend (split handlers, dedup, dead code). Phase 2 extracts a shared Rust `core/` module and switches the frontend from Tauri invoke to HTTP `fetch()` for data calls. Phase 3 tightens TypeScript config (strict mode), cleans dependencies, and adds CI. Phase 4 fixes deep architectural issues (Ref/State dualism, circular dependencies, dangerouslySetInnerHTML).

**Tech Stack:** React 19 + TypeScript (frontend), Rust + Tauri v2 + axum + symphonia (backend), pnpm (package manager), Vitest (new tests).

## Global Constraints

- No new features — pure refactoring, behavior must remain identical
- Use `pnpm typecheck` and `pnpm build` after every task to verify
- Use `cargo check` and `cargo clippy` after Rust changes
- Commit after each task completes
- Manual smoke test checklist: play, pause, stop, next, prev, seek, volume, playlist switch, import, export, lyrics toggle, theme switch, track info/move/copy/delete

---

## File Structure

### New Files

```
src/utils/guards.ts          # hasError() — single source
src/utils/css.ts             # applyCssVars — from SettingsContext
src/constants/themes.ts      # SHADOW_PRESETS, BUILTIN_THEMES — from SettingsContext
src/commands/helpLayout.ts   # printHelp data — from TerminalContext
src/commands/handlers/index.ts        # CommandContext interface, setCommandContext, registerAllCommands
src/commands/handlers/playback.ts     # play, pause, stop, next, prev, seek, mode, vol
src/commands/handlers/playlist.ts     # open, cd, import, list, pl, track
src/commands/handlers/appearance.ts   # color, colors, bg, blur, font, set, bar
src/commands/handlers/lyrics.ts       # lyric
src/commands/handlers/sync.ts         # sync (playlist + theme export/import)
src/commands/handlers/system.ts       # lang, help, clear, reset, quit, audio
src/components/SafeHtml.tsx          # whitelist-based HTML rendering

src/bridge/http.ts           # fetch() wrapper for data API calls
src/bridge/hybrid.ts         # combine http.ts + tauri.ts → IBridge

src-tauri/src/core/mod.rs
src-tauri/src/core/playlist.rs    # unified playlist CRUD + audio file search
src-tauri/src/core/lyrics.rs      # LRC search, parse, offset read/write
src-tauri/src/core/metadata.rs    # audio metadata (lofty wrapper)
src-tauri/src/core/files.rs       # ZIP, config paths, file listing

.github/workflows/ci.yml
```

### Deleted Files

```
src/commands/handlers.ts     # split into handlers/*.ts
src-tauri/src/config_cmd.rs  # replaced by HTTP + core
src-tauri/src/fs_cmd.rs      # replaced by HTTP + core
src-tauri/src/lrc_cmd.rs     # replaced by HTTP + core
src-tauri/src/metadata_cmd.rs # replaced by HTTP + core
src-tauri/src/zip_cmd.rs     # replaced by HTTP + core
package-lock.json            # stale npm lockfile
```

### Modified Files

```
src/contexts/SettingsContext.tsx    # import defaults from configStore, remove applyCssVars
src/contexts/TerminalContext.tsx    # delegate printHelp to helpLayout
src/contexts/PlayerContext.tsx      # Phase 4: Ref→State conversion
src/contexts/PlaylistContext.tsx    # Phase 4: remove circular dependency
src/configStore.ts                  # export DEFAULT_SETTINGS, BUILTIN_THEMES, import hasError from guards
src/bridge/index.ts                 # adjust IBridge if needed
src/bridge/tauri.ts                 # reduce to non-HTTP methods only
src/i18n/translations.ts            # remove dead keys, add helpAudio
src/utils/format.ts                 # remove parseCommand
src/utils/color.ts                  # remove isValidHexOrRgb
src/components/InputLine.tsx        # import ctx from handlers/index
src/components/Terminal.tsx         # Phase 4: use SafeHtml
src/components/SelectList.tsx       # Phase 4: use SafeHtml

src-tauri/src/main.rs               # start HTTP server in GUI mode
src-tauri/src/lib.rs                # remove deleted cmd modules from invoke_handler
src-tauri/src/server/http.rs        # call core::*, add missing routes
src-tauri/src/server/repl.rs        # call core::*, reduce duplication
src-tauri/src/audio/mod.rs          # expose is_playing, get_volume
src-tauri/src/server_state.rs       # simplify

tsconfig.app.json                    # strict: true
tsconfig.node.json                   # strict: true
package.json                         # remove esbuild, add scripts
Cargo.toml                           # slim tokio features, remove chrono serde, add symphonia codecs
vite.config.ts                       # unify boolean coercion
index.html                           # add favicon link
.gitignore                           # clean up
```

---

## Phase 1: Frontend Cleanup

### Task 1.1: Create shared utility files

**Files:**
- Create: `src/utils/guards.ts`
- Create: `src/utils/css.ts`
- Create: `src/constants/themes.ts`

**Interfaces:**
- Produces: `hasError(obj: unknown): obj is { error: string }` from `guards.ts`
- Produces: `applyCssVars(s: AppSettings): void` from `css.ts`
- Produces: `SHADOW_PRESETS: Record<string, string>` and `BUILTIN_THEMES: Theme[]` from `constants/themes.ts`

- [ ] **Step 1: Create `src/utils/guards.ts`**

```typescript
export function hasError(obj: unknown): obj is { error: string } {
  return typeof obj === 'object' && obj !== null && 'error' in obj;
}
```

- [ ] **Step 2: Create `src/utils/css.ts`**

Copy the entire `applyCssVars` function body from `src/contexts/SettingsContext.tsx:105-154` into this file. Add necessary imports:

```typescript
import type { AppSettings } from '../types';
import { parseColor, formatColor, darken } from './color';
import { convertFileSrc } from '@tauri-apps/api/core';

export function applyCssVars(s: AppSettings) {
  const root = document.documentElement;
  root.style.setProperty('--bg', s.bg);
  root.style.setProperty('--bg-darker', s['bg-darker'] || darken(s.bg, 0.85));
  root.style.setProperty('--fg', s.fg);
  root.style.setProperty('--fg-dim', s['fg-dim']);
  root.style.setProperty('--fg-bright', s['fg-bright']);
  root.style.setProperty('--accent', s.accent);
  root.style.setProperty('--line', s.line);
  root.style.setProperty('--lyric', s.lyric);

  if (s['bg-img']) {
    const imgPath = s['bg-img'].replace(/\\/g, '/');
    const imgUrl = (window as any).__TAURI_INTERNALS__
      ? convertFileSrc(imgPath)
      : `file:///${imgPath}`;
    root.style.setProperty('--bg-img', `url(${imgUrl})`);
  } else if (s['bg-img-data']) {
    const ext = s['bg-img-data'].startsWith('/9j/') ? 'jpg' :
                s['bg-img-data'].startsWith('iVBOR') ? 'png' :
                s['bg-img-data'].startsWith('R0lG') ? 'gif' :
                s['bg-img-data'].startsWith('UklGR') ? 'webp' : 'jpg';
    root.style.setProperty('--bg-img', `url(data:image/${ext};base64,${s['bg-img-data']})`);
  } else {
    root.style.setProperty('--bg-img', 'none');
  }
  root.style.setProperty('--bg-blur', `${s['bg-blur'] || 0}px`);
  root.style.setProperty('--font-size', `${s.fontSize || 14}px`);
  root.style.setProperty('--font-weight', String(s.fontWeight || 400));

  const baseFonts = '"Consolas", "Courier New", "Fira Code", monospace';
  if (s.customFont && s.customFontData) {
    let styleEl = document.getElementById('custom-font-style') as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'custom-font-style';
      document.head.appendChild(styleEl);
    }
    const ext = s.customFontData.startsWith('data:font/woff2') ? 'woff2' :
                s.customFontData.startsWith('data:font/woff') ? 'woff' :
                s.customFontData.startsWith('data:font/otf') ? 'otf' : 'truetype';
    styleEl.textContent = `@font-face { font-family: '${s.customFont}'; src: url(${s.customFontData}) format('${ext}'); }`;
    root.style.setProperty('--font', `"${s.customFont}", ${baseFonts}`);
  } else {
    const styleEl = document.getElementById('custom-font-style');
    if (styleEl) styleEl.remove();
    root.style.setProperty('--font', baseFonts);
  }
}
```

Also export a helper:

```typescript
export function toCssShadow(preset: string): string {
  const SHADOW_PRESETS: Record<string, string> = {
    large: '0 0 8px rgba(0,0,0,0.4),0 4px 3px rgba(0,0,0,0.7)',
    medium: '0 0 6px rgba(0,0,0,0.5),0 2px 1px rgba(0,0,0,0.5)',
    small: '0 0 4px rgba(0,0,0,0.7)',
  };
  return SHADOW_PRESETS[preset] || 'none';
}
```

- [ ] **Step 3: Create `src/constants/themes.ts`**

```typescript
import type { Theme } from '../types';

export const SHADOW_PRESETS: Record<string, string> = {
  large: '0 0 8px rgba(0,0,0,0.4),0 4px 3px rgba(0,0,0,0.7)',
  medium: '0 0 6px rgba(0,0,0,0.5),0 2px 1px rgba(0,0,0,0.5)',
  small: '0 0 4px rgba(0,0,0,0.7)',
};

export const BUILTIN_THEMES: Theme[] = [
  {
    name: 'dark', bg: '#0c0c0c', fg: '#f2f2f2', 'fg-dim': '#cccccc',
    'fg-bright': '#b1b9f9', accent: '#888888', lyric: '#888888', line: '#686868',
    'bg-img-data': '', 'bg-blur': 0, fontSize: 14, fontWeight: 400,
    customFont: '', customFontData: '',
  },
  {
    name: 'Claude Desktop', bg: '#FAF9F5', fg: '#141413', 'fg-dim': '#5E5D59',
    'fg-bright': '#D97757', accent: '#d4a853', lyric: '#5E5D59', line: '#2d2a25',
    'bg-img-data': '', 'bg-blur': 0, fontSize: 14, fontWeight: 400,
    customFont: '', customFontData: '',
  },
];
```

- [ ] **Step 4: Verify**

Run: `pnpm typecheck` — should pass since no consumers yet.
Commit.

---

### Task 1.2: Dedup DEFAULT_SETTINGS and BUILTIN_THEMES

**Files:**
- Modify: `src/configStore.ts:59-110` — add `export` to `DEFAULT_SETTINGS` and `BUILTIN_THEMES`
- Modify: `src/contexts/SettingsContext.tsx:14-75` — import from configStore instead of defining locally

**Interfaces:**
- Consumes: `DEFAULT_SETTINGS`, `BUILTIN_THEMES` from `configStore.ts`
- Produces: SettingsContext uses configStore as single source for defaults

- [ ] **Step 1: Export from configStore**

Change `src/configStore.ts` line 59 from `const DEFAULT_SETTINGS` to `export const DEFAULT_SETTINGS`, and line 97 from `const BUILTIN_THEMES` to `export const BUILTIN_THEMES`.

- [ ] **Step 2: Update SettingsContext imports**

In `src/contexts/SettingsContext.tsx`, update imports (lines 7-12):

```typescript
import {
  getSettings as getSettingsFromStore,
  getThemes as getThemesFromStore,
  saveSettings as saveSettingsToStore,
  saveThemes as saveThemesToStore,
  DEFAULT_SETTINGS,
  BUILTIN_THEMES,
} from '../configStore';
```

- [ ] **Step 3: Remove local definitions**

Remove `SHADOW_PRESETS` (lines 14-18), `toCssShadow` (lines 20-22), `defaults` object (lines 24-60), and `BUILTIN_THEMES` (lines 62-75) from SettingsContext.tsx. Replace references:

- `{ ...defaults, ...current, ...partial }` → `{ ...DEFAULT_SETTINGS, ...current, ...partial }`
- `defaults` reference in `getCurrentSettings` → `DEFAULT_SETTINGS`
- `applyCssVars(merged)` → `import { applyCssVars } from '../utils/css'` + call
- `toCssShadow` → `import { toCssShadow } from '../utils/css'`
- `BUILTIN_THEMES.some(...)` → use imported version
- `SHADOW_PRESETS` → `import { SHADOW_PRESETS } from '../constants/themes'`

- [ ] **Step 4: Update PlayerContext and TerminalContext**

In `src/contexts/PlayerContext.tsx`, replace the import of `getStoredSettings` from SettingsContext if it still references the old defaults. Add import: `import { DEFAULT_SETTINGS } from '../configStore'` if needed.

- [ ] **Step 5: Verify**

Run: `pnpm typecheck && pnpm build`
Expected: Clean build.
Commit.

---

### Task 1.3: Dead code cleanup

**Files:**
- Modify: `src/utils/format.ts` — remove `parseCommand`
- Modify: `src/utils/color.ts` — remove `isValidHexOrRgb`
- Modify: `src/bridge/tauri.ts` — remove `selectSaveDir`, `onLyricsVisibilityChanged` (unused methods)
- Modify: `src/bridge/index.ts` — remove corresponding interface methods
- Modify: `src/i18n/translations.ts` — remove `completionAll`, `completionMatches`, `helpBgClear`, add `helpAudio`

**Interfaces:**
- Produces: Cleaner files with no dead exports

- [ ] **Step 1: Remove `parseCommand` from format.ts**

Delete lines containing `export function parseCommand(...)` and its body from `src/utils/format.ts`. Check with `rg "parseCommand" src/` to confirm no usages remain.

- [ ] **Step 2: Remove `isValidHexOrRgb` from color.ts**

Delete the function definition (approximately lines 33-35) from `src/utils/color.ts`. Check `rg "isValidHexOrRgb" src/`.

- [ ] **Step 3: Remove unused bridge methods**

In `src/bridge/tauri.ts`, delete:
- `selectSaveDir()` implementation (approx line 165-167)
- `onLyricsVisibilityChanged()` implementation (approx line 147-153)

In `src/bridge/index.ts`, remove corresponding declarations from `IBridge` interface:
- Remove `selectSaveDir: () => Promise<string>;` (line ~33)
- Remove `onLyricsVisibilityChanged: (cb: (visible: boolean) => void) => Promise<() => void>;` (line ~30)

- [ ] **Step 4: Clean translations**

In `src/i18n/translations.ts`, remove these keys from all three language sections (en, zh, ja):
- `completionAll`
- `completionMatches`
- `helpBgClear`

Add `helpAudio` key to all three language sections:
```
en: "Audio mode and device management"
zh: "音频模式和设备管理"
ja: "オーディオモードとデバイス管理"
```

- [ ] **Step 5: Verify**

Run: `pnpm typecheck`
Expected: No "unused" errors, no missing import errors.
Commit.

---

### Task 1.4: Extract helpLayout from TerminalContext

**Files:**
- Create: `src/commands/helpLayout.ts`
- Modify: `src/contexts/TerminalContext.tsx:125-173` — replace inline printHelp with import

**Interfaces:**
- Produces: `printHelp(printLine: (text: string, className?: string) => void, printRaw: (text: string) => void): void` from helpLayout.ts

- [ ] **Step 1: Create `src/commands/helpLayout.ts`**

Move the entire body of `printHelp` from TerminalContext (lines 125-173) into this new file. The function signature:

```typescript
import { t } from '../i18n';

export function printHelp(
  printLine: (text: string, className?: string) => void,
  printRaw: (text: string) => void,
  maxWidth: number
): void {
  // ... move the entire function body here
  // Replace any direct ctx references with parameter calls
  // Replace hardcoded maxWidth references with the parameter
}
```

- [ ] **Step 2: Simplify TerminalContext**

In `src/contexts/TerminalContext.tsx`, replace the `printHelp` function body with:

```typescript
import { printHelp as renderHelp } from '../commands/helpLayout';

// In the context value:
const printHelp = useCallback(() => {
  renderHelp(printLine, printRaw, 80); // or read from settings
}, [printLine, printRaw]);
```

- [ ] **Step 3: Verify**

Run: `pnpm typecheck && pnpm build`
Commit.

---

### Task 1.5: Create handlers directory and CommandContext module

**Files:**
- Create: `src/commands/handlers/index.ts`
- Modify: `src/commands/registry.ts` — no changes needed

**Interfaces:**
- Produces: `CommandContext` interface, `setCommandContext(ctx: CommandContext): void`, `registerAllCommands(): void`

- [ ] **Step 1: Create `src/commands/handlers/index.ts`**

Move `CommandContext` interface (handlers.ts:21-96) and `setCommandContext` function (handlers.ts:98-100) and `_ctx` + `ctx()` helper (handlers.ts:18-19, 102-105) into this file. Also move `readMetadata` (107-114) and `printNowPlaying` (116-128) and `showMetadata` (130-147) and `sanitizeName` (14-16) as these are shared helpers.

```typescript
import { register } from '../registry';
import { t } from '../../i18n';
import { getBridge } from '../../bridge';
import { hasError } from '../../utils/guards';
import { escapeHtml, formatTime, getFileName } from '../../utils/format';
import { darken } from '../../utils/color';
import type { SelectCandidate, InteractiveItem, MetadataResult, Theme } from '../../types';

export interface CommandContext {
  printLine: (text: string, className?: string) => void;
  printRaw: (text: string) => void;
  printKV: (title: string | null, pairs: [string, string | number | null][]) => void;
  printList: (title: string | null, items: { name: string; meta?: string; sub?: string; highlight?: boolean }[]) => void;
  printHelp: () => void;
  clearTerminal: () => void;
  enterSelectMode: (candidates: SelectCandidate[]) => void;
  exitSelectMode: () => void;
  enterImode: (mode: 'import' | 'track-pl' | 'track-select', items: InteractiveItem[], cb: (selected: InteractiveItem[]) => void) => void;
  exitImode: () => void;
  enterSeekMode: () => void;
  exitSeekMode: () => void;
  // Player
  playlist: string[];
  currentIndex: number;
  getPlaylist: () => string[];
  addToPlaylist: (paths: string[]) => void;
  clearPlaylist: () => void;
  play: () => void;
  pause: () => void;
  stop: () => void;
  playIndex: (idx: number) => string | undefined;
  next: () => string | undefined;
  prev: () => string | undefined;
  seek: (secs: number) => void;
  setVolume: (v: number) => void;
  getVolume: () => number;
  getCurrentTime: () => number;
  getDuration: () => number;
  cyclePlayMode: () => string;
  loadLRC: (mp3Path: string) => Promise<boolean>;
  // Lyrics
  lyricsTerminal: boolean;
  lyricsFloating: boolean;
  toggleTerminalLyrics: () => void;
  toggleFloatingLyrics: () => void;
  setLyricsTerminal: (v: boolean) => Promise<void>;
  setLyricsFloating: (v: boolean) => Promise<void>;
  // Settings
  saveSettings: (partial: Record<string, unknown>) => void;
  resetSettings: () => void;
  applyTheme: (name: string) => boolean;
  // Playlists
  replaceCurrentTracks: (tracks: string[]) => void;
  addTracksToCurrent: (tracks: string[]) => void;
  getCurrentPlName: () => string;
  switchPlaylist: (name: string) => unknown;
  getPlaylistsForTrack: (path: string) => string[];
  syncTrackToPlaylists: (path: string, names: string[]) => void;
  listAllPlaylists: () => { name: string; desc: string; createdAt: string; trackCount: number; isCurrent: boolean }[];
  getCurrentPlaylist: () => { name: string; desc: string; tracks: string[] } | null;
  getPlaylistData: (name: string) => import('../../types').Playlist | null;
  createPlaylist: (name: string, desc?: string, sharer?: string) => { success: boolean; error?: string };
  createPlaylistWithTracks: (name: string, desc: string | undefined, sharer: string | undefined, tracks: string[]) => boolean;
  deletePlaylist: (name: string) => { success: boolean; error?: string };
  editPlaylist: (name: string, field: string, value: string) => { success: boolean; error?: string };
  ensureDefault: () => void;
  // Theme
  themeNames: () => string[];
  getTheme: (name: string) => Theme | null;
  saveCurrentTheme: (name: string) => void;
  deleteTheme: (name: string) => { success: boolean; error?: string };
  exportTheme: (name: string) => Theme | null;
  // Language
  setLangFn: (lang: string) => boolean;
  // Lyrics floating window
  syncLyricsTheme: () => void;
  // Misc
  getStoredSettings: () => import('../../types').AppSettings;
}

let _ctx: CommandContext | null = null;

export function setCommandContext(ctx: CommandContext) {
  _ctx = ctx;
}

export function ctx(): CommandContext {
  if (!_ctx) throw new Error('Command context not initialized');
  return _ctx;
}

export function sanitizeName(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, '_').slice(0, 120);
}

export async function readMetadata(filePath: string): Promise<MetadataResult | null> {
  const result = await getBridge().readMetadata(filePath);
  if (hasError(result)) {
    ctx().printLine(t('metadataError', { err: result.error }), 'error');
    return null;
  }
  return result as MetadataResult;
}

export function printNowPlaying(meta: MetadataResult) {
  const c = ctx();
  c.printRaw('');
  c.printLine(`<cmd>${t('nowPlaying')}</cmd>`, 'success');
  c.printRaw('  ' + meta.title);
  const pairs: [string, string | number | null][] = [
    [t('fieldArtist'), meta.artist],
    [t('fieldAlbum'), meta.album],
  ];
  if (meta.year) pairs.push([t('fieldYear'), String(meta.year)]);
  if (meta.genre) pairs.push([t('fieldGenre'), meta.genre]);
  c.printKV(null, pairs);
}

export function showMetadata(meta: MetadataResult | null) {
  if (!meta) return;
  const durationStr = meta.duration
    ? formatTime(meta.duration)
    : '-';
  ctx().printKV(t('metadataTitle'), [
    [t('fieldTitle'), meta.title],
    [t('fieldArtist'), meta.artist],
    [t('fieldAlbum'), meta.album],
    [t('fieldYear'), meta.year],
    [t('fieldGenre'), meta.genre],
    [t('fieldTrack'), meta.track],
    [t('fieldDuration'), durationStr],
    [t('fieldBitrate'), meta.bitrate ? meta.bitrate + ' kbps' : '-'],
    [t('fieldSampleRate'), meta.sampleRate ? meta.sampleRate + ' Hz' : '-'],
    [t('fieldCodec'), meta.codec],
  ]);
}
```

Note: `showMetadata` now uses `formatTime(meta.duration)` instead of manual `Math.floor/60 + padStart` math. This fixes the inline duration formatting bug.

- [ ] **Step 2: Create `playTrack` shared helper in handlers/index.ts**

Add this function which eliminates the 7x duplicated `readMetadata + printNowPlaying + loadLRC` pattern:

```typescript
export async function playTrack(filePath: string, printPlaying: boolean = true) {
  const c = ctx();
  const meta = await readMetadata(filePath);
  if (meta) {
    printNowPlaying(meta);
    await c.loadLRC(filePath);
  }
  if (printPlaying) c.printLine(t('playing'), 'success');
}
```

- [ ] **Step 3: Verify**

Run: `pnpm typecheck` — expect "unused imports" for `register` at this point (will be used in sub-modules).
Commit.

---

### Task 1.6: Extract handler sub-modules

**Files:**
- Create: `src/commands/handlers/system.ts`
- Create: `src/commands/handlers/lyrics.ts`
- Create: `src/commands/handlers/appearance.ts`
- Create: `src/commands/handlers/sync.ts`
- Create: `src/commands/handlers/playlist.ts`
- Create: `src/commands/handlers/playback.ts`

**Approach:** Each sub-module imports `{ register }` from `'../registry'`, `{ ctx }` and shared helpers from `'./index'`, and calls `register(...)` at module level.

- [ ] **Step 1: Create `handlers/system.ts`**

Move these commands from handlers.ts:
- `lang` (line 936-945)
- `help` (line 948)
- `clear` (line 951)
- `reset` (line 1347-1351)
- `quit` (line 1354)
- `audio` (line 1303-1344)

```typescript
import { register } from '../registry';
import { ctx } from './index';
import { t } from '../../i18n';
import { getBridge } from '../../bridge';
import { getStoredSettings } from '../../contexts/SettingsContext';

export function registerSystemCommands() {
  register('lang', ['language', 'locale'], (args) => {
    const c = ctx();
    const lang = (args[0] || '').toLowerCase();
    if (!['en', 'zh', 'ja'].includes(lang)) { c.printLine(t('langUsage'), 'info'); return; }
    if (c.setLangFn(lang)) {
      c.clearTerminal();
      c.setVolume(c.getVolume());
      c.printLine(t('langSet', { lang }), 'success');
    }
  }, 'helpLang');

  register('help', ['?', 'h'], () => ctx().printHelp(), 'helpHelp');
  register('clear', ['cls'], () => ctx().clearTerminal(), 'helpClear');

  register('reset', [], () => {
    ctx().resetSettings();
    ctx().printLine(t('resetDone'), 'success');
  }, 'helpReset');

  register('quit', ['exit', 'q'], () => getBridge().close(), 'helpQuit');

  register('audio', ['aud'], async (args) => {
    const c = ctx();
    const sub = (args[0] || '').toLowerCase();
    if (sub === 'mode') {
      const modeArg = (args[1] || '').toLowerCase();
      if (modeArg === 'normal' || modeArg === 'default' || modeArg === 'wasapi' || modeArg === 'w') {
        try {
          const result = await getBridge().setAudioMode('normal');
          c.printLine(result, 'success');
        } catch (err) { c.printLine(String(err), 'error'); }
      } else if (modeArg === 'asio' || modeArg === 'exclusive' || modeArg === 'a') {
        try {
          const result = await getBridge().setAudioMode('asio');
          c.printLine(result, 'success');
        } catch (err) { c.printLine(String(err), 'error'); }
      } else {
        try {
          const current = await getBridge().getAudioMode();
          c.printLine(`<cmd>Audio Mode:</cmd> ${current}`, 'info');
          c.printRaw('  normal     - System audio (default)');
          c.printRaw('  asio       - ASIO exclusive (requires ASIO drivers)');
        } catch (err) { c.printLine(String(err), 'error'); }
      }
    } else if (sub === 'devices') {
      try {
        const devices = await getBridge().listAudioDevices();
        c.printLine('<cmd>Audio Devices:</cmd>', 'accent');
        devices.forEach((d, i) => c.printRaw(`  ${i + 1}. ${d}`));
      } catch (err) { c.printLine(String(err), 'error'); }
    } else {
      c.printLine('Usage: audio mode [normal|asio] | audio devices', 'info');
    }
  }, 'helpAudio');
}
```

- [ ] **Step 2: Create `handlers/lyrics.ts`**

Move the entire `lyric` command handler (lines 699-837) from handlers.ts into this file. Wrap in `export function registerLyricsCommands()`. Import `{ register }` from `'../registry'`, `{ ctx, playTrack }` from `'./index'`, `{ getStoredSettings }` from `'../../contexts/SettingsContext'`, `{ hasError }` from `'../../utils/guards'`, and `{ getBridge }` from `'../../bridge'`.

- [ ] **Step 3: Create `handlers/appearance.ts`**

Move the `COLOR_TYPE_MAP`, `handleVol`, `handleColor`, `handleShowColors`, `handleBg`, `handleBlur`, `handleFont` helpers (lines 151-? from handlers.ts), plus the `set`, `color`, `colors`, `bg`, `blur`, `font`, `bar`, `mode`, `vol` command registrations. Also move `seek` command (lines 892-933).

```typescript
import { register } from '../registry';
import { ctx, showMetadata } from './index';
import { t } from '../../i18n';
import { getBridge } from '../../bridge';
import { getStoredSettings } from '../../contexts/SettingsContext';
import { formatTime, escapeHtml, getFileName } from '../../utils/format';
import { darken, parseColor, formatColor } from '../../utils/color';
import { hasError } from '../../utils/guards';
import { fuzzySearch } from '../../utils/fuzzy';

// ... COLOR_TYPE_MAP, handleVol, handleColor, etc.
// ... register calls for vol, color, colors, bg, blur, font, set, bar, mode, seek
```

- [ ] **Step 4: Create `handlers/sync.ts`**

Move the entire `sync` command (lines 1013-1300). This includes playlist export/import and theme save/load/delete/export/import. Extract as `export function registerSyncCommands()`.

- [ ] **Step 5: Create `handlers/playlist.ts`**

Move: `open` (lines ~280-312), `cd` (314-337), `import` (339-358), `track` (360-600), `list` (688-697), `pl` (953-1002), `info` (681-686).

**Critical dedup:** In the `track` handler, replace the verbatim-duplicated `track delete` (519-541), `track move` (544-566), `track copy` (568-588) handlers with calls to the `track pl` versions. Since both are in the same module, use:

```typescript
// track delete → just redirect
if (sub === 'delete') { rest[0] = 'pl'; args = ['pl', 'delete', ...rest]; }
// After the redirect, let the track pl handler pick it up
```

Or simpler: within the `track` handler's `pl` branch, add aliases:

```typescript
if (sub === 'pl' || sub === 'edit' || sub === 'delete' || sub === 'move' || sub === 'copy') {
  // Normalize sub so 'track delete' → 'track pl delete'
  const normalizedSub = (sub === 'delete' || sub === 'move' || sub === 'copy') ? 'pl' : sub;
  const normalizedRest = (sub === 'delete' || sub === 'move' || sub === 'copy') ? [sub, ...rest] : rest;
  const subSub = (normalizedRest[0] || '').toLowerCase();
  // ... rest of track pl logic uses subSub and normalizedRest
}
```

- [ ] **Step 6: Create `handlers/playback.ts`**

Move: `play` (603-649), `pause` (651-654), `stop` (656-659), `next` (661-669), `prev` (671-679) commands.

Use `playTrack` helper from `./index` to simplify `play`, `next`, `prev`:

```typescript
import { register } from '../registry';
import { ctx, readMetadata, printNowPlaying, playTrack } from './index';
import { t } from '../../i18n';
import { fuzzySearch } from '../../utils/fuzzy';
import { getFileName } from '../../utils/format';

export function registerPlaybackCommands() {
  register('play', ['resume'], async (args) => {
    const c = ctx();
    const pl = c.playlist;
    if (pl.length === 0) { c.printLine(t('noTrackLoaded'), 'info'); return; }

    if (args.length === 0) {
      if (c.currentIndex >= 0) {
        c.play();
        c.printLine(t('playing'), 'success');
      } else {
        const fp = c.playIndex(0);
        if (fp) await playTrack(fp, true);
      }
      return;
    }

    const arg = args.join(' ');
    if (/^\d+$/.test(arg)) {
      const num = parseInt(arg, 10);
      if (num < 1 || num > pl.length) { c.printLine(t('invalidIndex', { n: num, max: pl.length }), 'error'); return; }
      const fp = c.playIndex(num - 1);
      if (fp) await playTrack(fp, true);
      return;
    }

    const results = fuzzySearch(arg, pl);
    if (results.length === 0) { c.printLine(t('noMatch', { q: arg }), 'error'); return; }
    if (results.length === 1) {
      const fp = c.playIndex(results[0].idx);
      if (fp) await playTrack(fp, true);
      return;
    }
    c.printLine(t('fuzzyResults', { q: arg, n: results.length }), 'accent');
    c.enterSelectMode(results.map(r => ({ idx: r.idx, name: r.name })));
  }, 'helpPlay');

  register('pause', ['paus'], () => {
    ctx().pause();
    ctx().printLine(t('paused'), 'info');
  }, 'helpPause');

  register('stop', [], () => {
    ctx().stop();
    ctx().printLine(t('stopped'), 'info');
  }, 'helpStop');

  register('next', ['n', 'skip'], async () => {
    const c = ctx();
    const fp = c.next();
    if (!fp) { c.printLine(t('noMoreTracks'), 'info'); return; }
    await playTrack(fp, false);
    c.printLine(t('skippedNext'), 'success');
  }, 'helpNext');

  register('prev', ['p', 'back', 'previous'], async () => {
    const c = ctx();
    const fp = c.prev();
    if (!fp) { c.printLine(t('noPrevTrack'), 'info'); return; }
    await playTrack(fp, false);
    c.printLine(t('backPrev'), 'success');
  }, 'helpPrev');
}
```

- [ ] **Step 7: Verify**

Run: `pnpm typecheck` (expect clean after all sub-modules created).
Commit.

---

### Task 1.7: Wire up registerAllCommands and delete old handlers.ts

**Files:**
- Modify: `src/commands/handlers/index.ts` — add `registerAllCommands`
- Modify: `src/commands/handlers.ts` — delete the file
- Modify: `src/components/InputLine.tsx` — update imports

- [ ] **Step 1: Add `registerAllCommands` to handlers/index.ts**

```typescript
import { registerSystemCommands } from './system';
import { registerLyricsCommands } from './lyrics';
import { registerAppearanceCommands } from './appearance';
import { registerSyncCommands } from './sync';
import { registerPlaylistCommands } from './playlist';
import { registerPlaybackCommands } from './playback';

export function registerAllCommands() {
  registerSystemCommands();
  registerLyricsCommands();
  registerAppearanceCommands();
  registerSyncCommands();
  registerPlaylistCommands();
  registerPlaybackCommands();
}

// Register at module load time — survives Vite HMR
registerAllCommands();
```

- [ ] **Step 2: Update InputLine.tsx imports**

Change `src/components/InputLine.tsx` import from:
```typescript
import { setCommandContext } from '../commands/handlers';
```
to:
```typescript
import { setCommandContext, CommandContext } from '../commands/handlers/index';
```

The `CommandContext` type usage in InputLine.tsx stays the same — just update the import path.

- [ ] **Step 3: Delete old handlers.ts**

```bash
rm src/commands/handlers.ts
```

- [ ] **Step 4: Update any other importers**

Run `rg "from.*commands/handlers\b" src/ --include '*.ts' --include '*.tsx'` to find remaining imports from the old file. Update to `'../commands/handlers/index'` pattern. (Likely only App.tsx or AppInitializer uses `setCommandContext`.)

- [ ] **Step 5: Verify**

```bash
pnpm typecheck
pnpm build
```

Both must pass. Delete-and-recreate of handlers.ts means Vite will hot-reload — do a full `pnpm dev` restart.
Commit.

---

### Task 1.8: Phase 1 Smoke Test

- [ ] **Step 1: Start the dev server**

```bash
pnpm tauri dev
```

- [ ] **Step 2: Run through commands**

Execute these commands and verify output:
```
play          (should work with loaded tracks)
pause / play  (toggle)
stop          (stops playback)
next / prev   (track navigation)
seek 30       (seek to 30s)
seek step 10  (change seek step)
vol 50        (set volume)
list          (list playlist)
pl list       (list named playlists)
pl create TestPlaylist
cd TestPlaylist
import        (import tracks)
track info    (show track info)
bg #ff0000    (change background)
color fg #00ff00  (change text color)
colors        (show palette)
bar width 30  (change progress bar)
mode          (cycle play modes)
lyric         (toggle lyrics)
lyric floating  (toggle floating)
sync theme list
sync theme save MyTheme
lang zh       (switch to Chinese)
help          (show help)
clear         (clear terminal)
audio mode    (show audio mode)
```

All commands should work identically to before.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "refactor: phase 1 — split handlers, dedup, dead code cleanup"
```

---

## Phase 2: Rust Core Layer + REST Frontend

### Task 2.1: Create core/files.rs and core/metadata.rs

**Files:**
- Create: `src-tauri/src/core/mod.rs`
- Create: `src-tauri/src/core/files.rs`
- Create: `src-tauri/src/core/metadata.rs`
- Modify: `src-tauri/src/lib.rs` — add `mod core;`

- [ ] **Step 1: Create `src-tauri/src/core/mod.rs`**

```rust
pub mod files;
pub mod metadata;
pub mod lyrics;
pub mod playlist;
```

- [ ] **Step 2: Create `src-tauri/src/core/files.rs`**

Extract logic from `fs_cmd.rs` and `zip_cmd.rs`:

```rust
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

pub const AUDIO_EXTENSIONS: &[&str] = &["mp3", "flac", "wav", "ogg", "m4a", "wma"];

pub fn is_audio_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| AUDIO_EXTENSIONS.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

pub fn list_audio_files(dir: &str) -> Result<Vec<String>, String> {
    WalkDir::new(dir)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file() && is_audio_file(e.path()))
        .map(|e| e.path().to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .into_iter()
        .collect()
}

pub fn config_path(music_folder: &str) -> PathBuf {
    Path::new(music_folder).join("config")
}

pub fn read_file_base64(path: &str) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    Ok(base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes))
}

pub fn write_file(path: &str, content: &str) -> Result<(), String> {
    if let Some(parent) = Path::new(path).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(path, content).map_err(|e| e.to_string())
}

pub fn read_file(path: &str) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| e.to_string())
}

pub fn copy_file(src: &str, dest: &str) -> Result<(), String> {
    if let Some(parent) = Path::new(dest).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::copy(src, dest).map_err(|e| format!("copy {} → {}: {}", src, dest, e))?;
    Ok(())
}

pub fn mkdir(path: &str) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|e| e.to_string())
}
```

- [ ] **Step 3: Create `src-tauri/src/core/metadata.rs`**

Extract logic from `metadata_cmd.rs`:

```rust
use lofty::{read_from_path, AudioFile, ItemKey, Probe};
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
        _ => {
            // Try to probe with symphonia-compatible tags via lofty
            match Probe::open(path) {
                Ok(probe) => probe
                    .guessed_file_type()
                    .map(|ft| format!("{:?}", ft).split('(').next().unwrap_or("Unknown").to_string())
                    .unwrap_or_else(|| "Unknown".into()),
                Err(_) => "Unknown".into(),
            }
        }
    }
}

pub fn read_metadata(path: &str) -> Result<MetadataResult, String> {
    let tagged_file = read_from_path(path).map_err(|e| e.to_string())?;
    let tag = tagged_file.primary_tag().or_else(|| tagged_file.first_tag());
    let props = tagged_file.properties();

    let title = tag
        .and_then(|t| t.get(ItemKey::TrackTitle))
        .map(|t| t.value().to_string())
        .unwrap_or_else(|| {
            Path::new(path)
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string()
        });

    let artist = tag
        .and_then(|t| t.get(ItemKey::TrackArtist))
        .map(|a| a.value().to_string())
        .unwrap_or_else(|| "Unknown Artist".into());

    let album = tag
        .and_then(|t| t.get(ItemKey::AlbumTitle))
        .map(|a| a.value().to_string())
        .unwrap_or_default();

    let year = tag.and_then(|t| t.year()).map(|y| y as i32);
    let genre = tag.and_then(|t| t.genre().map(|g| g.to_string()));
    let track = tag.and_then(|t| t.track());
    let duration = props.map(|p| p.duration().as_secs_f64());
    let bitrate = props.map(|p| p.audio_bitrate());
    let sample_rate = props.map(|p| p.sample_rate());
    let codec = extract_codec(Path::new(path));

    Ok(MetadataResult {
        title, artist, album, year, genre, track,
        duration, bitrate, sample_rate, codec,
    })
}
```

- [ ] **Step 4: Add `mod core;` to `src-tauri/src/lib.rs`**

Add `pub mod core;` after the existing module declarations (around line 7, after `mod audio;`).

- [ ] **Step 5: Verify**

```bash
cd src-tauri && cargo check 2>&1
```

Expected: Compiles clean. Some dead-code warnings for unused functions (will be used in later tasks).
Commit.

---

### Task 2.2: Create core/lyrics.rs and core/playlist.rs

**Files:**
- Create: `src-tauri/src/core/lyrics.rs`
- Create: `src-tauri/src/core/playlist.rs`

- [ ] **Step 1: Create `src-tauri/src/core/lyrics.rs`**

```rust
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use walkdir::WalkDir;
use crate::lrc_parser;

pub fn find_lrc(audio_path: &str, root_dir: &str) -> Result<Option<String>, String> {
    let audio = Path::new(audio_path);
    let stem = audio.file_stem()
        .unwrap_or_default()
        .to_string_lossy();
    let lrc_name = format!("{}.lrc", stem);

    // 1. Same directory as audio file
    if let Some(parent) = audio.parent() {
        let candidate = parent.join(&lrc_name);
        if candidate.exists() {
            return Ok(Some(candidate.to_string_lossy().to_string()));
        }
        // Also check lrc/ subdirectory
        let lrc_sub = parent.join("lrc").join(&lrc_name);
        if lrc_sub.exists() {
            return Ok(Some(lrc_sub.to_string_lossy().to_string()));
        }
    }

    // 2. Music folder's lrc/ directory
    let global_lrc = Path::new(root_dir).join("lrc").join(&lrc_name);
    if global_lrc.exists() {
        return Ok(Some(global_lrc.to_string_lossy().to_string()));
    }

    // 3. Recursive search in music folder (limited depth)
    for entry in WalkDir::new(root_dir).max_depth(4).into_iter().filter_map(|e| e.ok()) {
        if entry.file_type().is_file()
            && entry.path().extension().map(|e| e == "lrc").unwrap_or(false)
            && entry.path().file_stem().unwrap_or_default() == stem.as_ref()
        {
            return Ok(Some(entry.path().to_string_lossy().to_string()));
        }
    }

    Ok(None)
}

pub fn read_lrc_offsets(lrc_dir: &str) -> Result<HashMap<String, i64>, String> {
    let path = Path::new(lrc_dir).join("offsets.json");
    if !path.exists() {
        return Ok(HashMap::new());
    }
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read offsets.json: {}", e))?;
    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse offsets.json: {}", e))
}

pub fn write_lrc_offset(lrc_dir: &str, track_name: &str, offset_ms: i64) -> Result<(), String> {
    let mut offsets = read_lrc_offsets(lrc_dir).unwrap_or_default();
    if offset_ms == 0 {
        offsets.remove(track_name);
    } else {
        offsets.insert(track_name.to_string(), offset_ms);
    }
    let path = Path::new(lrc_dir).join("offsets.json");
    fs::create_dir_all(lrc_dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(&offsets).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}
```

Note: The key fix here is `read_lrc_offsets` uses `map_err` instead of the buggy `unwrap_or()` from `lrc_cmd.rs:47`, so JSON parse errors are properly propagated.

- [ ] **Step 2: Create `src-tauri/src/core/playlist.rs`**

```rust
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
```

- [ ] **Step 3: Verify**

```bash
cd src-tauri && cargo check 2>&1
```

Commit.

---

### Task 2.3: Fix bugs in existing code

**Files:**
- Modify: `src-tauri/src/audio/engine.rs` — add `is_playing()` and `get_volume()` as Tauri commands
- Modify: `src-tauri/src/audio/mod.rs` — register new commands
- Modify: `src-tauri/Cargo.toml` — add symphonia codecs, slim tokio, remove chrono serde

- [ ] **Step 1: Expose is_playing and get_volume as Tauri commands**

In `src-tauri/src/audio/engine.rs`, these methods already exist at lines 196-202. Just verify they're `pub fn`.

In `src-tauri/src/audio/mod.rs`, add:

```rust
#[tauri::command]
pub fn is_playing(state: tauri::State<'_, crate::AppState>) -> Result<bool, String> {
    let engine = state.audio_engine.lock().map_err(|e| e.to_string())?;
    Ok(engine.is_playing())
}

#[tauri::command]
pub fn get_volume(state: tauri::State<'_, crate::AppState>) -> Result<u32, String> {
    let engine = state.audio_engine.lock().map_err(|e| e.to_string())?;
    Ok(engine.get_volume())
}
```

- [ ] **Step 2: Update Cargo.toml dependencies**

In `src-tauri/Cargo.toml`, change:

```toml
symphonia = { version = "0.6", features = ["mp3", "aac", "isomp4", "alac", "flac", "vorbis", "pcm", "wav"] }
```

```toml
tokio = { version = "1", features = ["rt-multi-thread", "net", "macros"], optional = true }
```

```toml
chrono = "0.4"
```

(Remove `features = ["serde"]` from `chrono` — that line becomes just the version.)

- [ ] **Step 3: Verify**

```bash
cd src-tauri && cargo check 2>&1
```

Commit.

---

### Task 2.4: Start HTTP server in GUI mode, pass port to frontend

**Files:**
- Modify: `src-tauri/src/main.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/server/http.rs`

- [ ] **Step 1: Add `start_http_server` function to http.rs**

```rust
use std::net::TcpListener;

pub fn start_in_background(state: Arc<Mutex<ServerState>>) -> u16 {
    // Bind to port 0 to get a random available port
    let listener = TcpListener::bind("127.0.0.1:0").expect("Failed to bind HTTP server");
    let port = listener.local_addr().unwrap().port();

    let app_state = state.clone();
    std::thread::spawn(move || {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let app = build_router(app_state);
            axum::serve(listener, app).await.unwrap();
        });
    });

    port
}
```

Note: `build_router` must be extracted as a separate function that takes `Arc<Mutex<ServerState>>` and returns the axum Router. The current `http.rs` `run_server` function contains the router setup inline — extract it.

- [ ] **Step 2: Update main.rs for GUI mode**

```rust
#[cfg(feature = "gui")]
fn main() {
    let server_state = Arc::new(Mutex::new(ServerState::new()));
    let port = crate::server::http::start_in_background(server_state.clone());

    // Pass port to Tauri frontend via environment or state
    std::env::set_var("MUSICLI_HTTP_PORT", port.to_string());

    crate::run_gui(server_state);
}
```

- [ ] **Step 3: Verify**

```bash
cd src-tauri && cargo check --features gui 2>&1
```

Commit.

---

### Task 2.5: Add missing HTTP API routes

**Files:**
- Modify: `src-tauri/src/server/http.rs`

- [ ] **Step 1: Add new routes**

Add these routes to the axum Router in `http.rs`:

```rust
// Config
.route("/config", get(read_config).put(write_config))
// Lyrics
.route("/lyrics", get(search_lyrics))
.route("/lyrics/offsets", get(read_lyrics_offsets).post(write_lyrics_offset))
// Files
.route("/files/list", get(list_audio_files))
.route("/files/read", get(read_file_base64))
// Sync (ZIP import/export already exists — verify coverage)
.route("/sync/export", post(export_playlist))
.route("/sync/import", post(import_playlist))
```

- [ ] **Step 2: Implement new handlers in http.rs**

Each handler should:
1. Extract `ServerState` from axum State
2. Call the appropriate `core::*` function
3. Return JSON response

Use existing patterns from http.rs (e.g., the `/status` handler) as template.

- [ ] **Step 3: Verify**

```bash
cd src-tauri && cargo check --features server 2>&1
```

Commit.

---

### Task 2.6: Create frontend HTTP bridge

**Files:**
- Create: `src/bridge/http.ts`
- Create: `src/bridge/hybrid.ts`
- Modify: `src/bridge/index.ts` — add `initHttpBridge`

- [ ] **Step 1: Create `src/bridge/http.ts`**

```typescript
let _port = 0;
let _baseUrl = '';

export function setServerPort(port: number) {
  _port = port;
  _baseUrl = `http://127.0.0.1:${port}`;
}

async function apiGet<T>(path: string): Promise<T | { error: string }> {
  try {
    const res = await fetch(`${_baseUrl}${path}`);
    if (!res.ok) return { error: `HTTP ${res.status}` };
    return res.json();
  } catch (e) {
    return { error: String(e) };
  }
}

async function apiPost<T>(path: string, body?: unknown): Promise<T | { error: string }> {
  try {
    const res = await fetch(`${_baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    return res.json();
  } catch (e) {
    return { error: String(e) };
  }
}

export function createHttpBridge() {
  return {
    // Audio
    getPosition: () => apiGet<{ position: number; duration: number; playing: boolean }>('/status'),
    play: (path: string) => apiPost('/play', { path }),
    pause: () => apiPost('/pause'),
    stop: () => apiPost('/stop'),
    next: () => apiPost('/next'),
    prev: () => apiPost('/prev'),
    seek: (secs: number) => apiPost('/seek', { seconds: secs }),
    setVolume: (v: number) => apiPost('/volume', { volume: v }),
    setAudioMode: (mode: string) => apiPost('/mode', { mode }),
    getAudioMode: () => apiGet<string>('/mode'),
    listAudioDevices: () => apiGet<string[]>('/devices'),

    // Metadata
    readMetadata: (path: string) => apiGet(`/metadata?path=${encodeURIComponent(path)}`),

    // Files
    listAudioFiles: (dir: string) => apiGet<string[]>(`/files/list?dir=${encodeURIComponent(dir)}`),
    readFileBase64: (path: string) => apiGet<string>(`/files/read?path=${encodeURIComponent(path)}`),
    dirExists: (path: string) => apiGet<boolean>(`/files/exists?path=${encodeURIComponent(path)}`),

    // Config
    readConfig: (key: string) => apiGet(`/config?key=${encodeURIComponent(key)}`),
    writeConfig: (data: Record<string, unknown>) => apiPost('/config', data),

    // Lyrics
    findLrc: (audioPath: string, rootDir: string) => apiGet<string | null>(`/lyrics?path=${encodeURIComponent(audioPath)}&root=${encodeURIComponent(rootDir)}`),
    readLrcOffsets: (lrcDir: string) => apiGet('/lyrics/offsets'),
    writeLrcOffset: (lrcDir: string, trackName: string, offset: number) => apiPost('/lyrics/offsets', { dir: lrcDir, track: trackName, offset }),

    // Sync
    createZip: (srcDir: string, destPath: string) => apiPost('/sync/export', { srcDir, destPath }),
    extractZip: (zipPath: string, destDir: string) => apiPost('/sync/import', { zipPath, destDir }),
    copyFile: (src: string, dest: string) => apiPost('/files/copy', { src, dest }),
    mkdir: (path: string) => apiPost('/files/mkdir', { path }),
    writeFile: (path: string, content: string) => apiPost('/files/write', { path, content }),
    readFile: (path: string) => apiGet<string>(`/files/read?path=${encodeURIComponent(path)}`),
  };
}
```

- [ ] **Step 2: Create `src/bridge/hybrid.ts`**

```typescript
import type { IBridge } from './index';
import { createHttpBridge, setServerPort } from './http';
import { createTauriBridge } from './tauri';

export function initHybridBridge(): IBridge {
  // Read port from Tauri environment
  const portStr = (window as any).__TAURI_INTERNALS__
    ? await getServerPort()  // Tauri: get from env
    : 3000;                   // Browser dev: default

  const port = Number(portStr) || 3000;
  setServerPort(port);

  const httpBridge = createHttpBridge();
  const tauriBridge = createTauriBridge();

  return {
    // ... spread tauriBridge for non-HTTP methods
    ...tauriBridge,
    // Override data methods with HTTP versions
    ...httpBridge,
  };
}

async function getServerPort(): Promise<number> {
  // Poll GET /status until server is ready
  for (let i = 0; i < 50; i++) {
    try {
      const port = (window as any).__MUSICLI_PORT__ || 0;
      if (port) return port;
    } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  return 3000;
}
```

- [ ] **Step 3: Update bridge/index.ts**

Add the hybrid bridge import and update `initBridge()` to use it in Tauri mode.

- [ ] **Step 4: Verify**

```bash
pnpm typecheck
```

Commit.

---

### Task 2.7: Reduce bridge/tauri.ts and integrate

**Files:**
- Modify: `src/bridge/tauri.ts` — remove methods now handled by HTTP, keep only dialog/window/lyrics events

- [ ] **Step 1: Reduce tauri.ts**

Keep only:
- `openFileDialog()`, `saveFileDialog()`, `selectFiles()`, `selectSyncFile()`, `openThemeDialog()`
- `sendLyricsTheme()`, `autoSizeLyrics()`, `setLyricsMouseEvents()`
- `getDefaultMusicDir()` (uses Tauri path API)
- `close()` (Tauri window close)

Remove all methods that `http.ts` now handles (readMetadata, play, pause, stop, etc.).

- [ ] **Step 2: Verify**

```bash
pnpm typecheck && pnpm build
```

Commit.

---

### Task 2.8: Slim down http.rs and repl.rs to use core::

**Files:**
- Modify: `src-tauri/src/server/http.rs` — replace inline playlist/metadata logic with `core::*` calls
- Modify: `src-tauri/src/server/repl.rs` — replace inline logic with `core::*` calls

- [ ] **Step 1: Refactor http.rs**

For each handler in http.rs, replace the inline logic with calls to `core::*`. Example:

```rust
// Before: inline playlist management
async fn list_playlists(State(state): State<Arc<Mutex<ServerState>>>) -> Json<Value> {
    let s = state.lock().unwrap();
    // ... inline playlist reading logic
}

// After: delegate to core
async fn list_playlists(State(state): State<Arc<Mutex<ServerState>>>) -> Json<Value> {
    let s = state.lock().unwrap();
    let music_folder = s.music_folder.lock().unwrap().clone();
    match core::playlist::list_playlists(&music_folder) {
        Ok(pls) => Json(serde_json::json!({ "playlists": pls })),
        Err(e) => Json(serde_json::json!({ "error": e })),
    }
}
```

- [ ] **Step 2: Refactor repl.rs**

For each REPL command, replace inline logic with `core::*` calls. The functions `nxt`, `prv`, `pl`, `track`, etc. become thin wrappers.

- [ ] **Step 3: Verify**

```bash
cd src-tauri && cargo check --features server 2>&1
```

Commit.

---

### Task 2.9: Delete old *_cmd.rs files, update lib.rs

**Files:**
- Delete: `src-tauri/src/config_cmd.rs`
- Delete: `src-tauri/src/fs_cmd.rs`
- Delete: `src-tauri/src/lrc_cmd.rs`
- Delete: `src-tauri/src/metadata_cmd.rs`
- Delete: `src-tauri/src/zip_cmd.rs`
- Modify: `src-tauri/src/lib.rs` — remove module declarations and invoke_handler entries

- [ ] **Step 1: Delete files**

```bash
rm src-tauri/src/config_cmd.rs src-tauri/src/fs_cmd.rs src-tauri/src/lrc_cmd.rs src-tauri/src/metadata_cmd.rs src-tauri/src/zip_cmd.rs
```

- [ ] **Step 2: Update lib.rs**

Remove the `mod` declarations and corresponding `invoke_handler` entries for the deleted modules. Keep only `mod audio`, `mod core`, `mod dialog_cmd`, `mod lyrics_cmd`, `mod window_cmd`, `mod server`.

- [ ] **Step 3: Verify**

```bash
cd src-tauri && cargo check 2>&1
```

Commit.

---

### Task 2.10: Phase 2 full verification

- [ ] **Step 1: Build and run**

```bash
cd src-tauri && cargo check && cargo clippy
pnpm build
pnpm tauri dev
```

- [ ] **Step 2: Test HTTP endpoints**

With the app running, in another terminal:

```bash
curl http://127.0.0.1:XXXXX/status
curl "http://127.0.0.1:XXXXX/config?key=settings"
curl "http://127.0.0.1:XXXXX/playlist"
```

All should return valid JSON.

- [ ] **Step 3: Smoke test GUI**

Run through the Phase 1 smoke test checklist. All commands must work.

- [ ] **Step 4: Test CLI REPL**

```bash
cargo run -- --cli
# In REPL: play / pause / next / list / pl list / lyric
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "refactor: phase 2 — Rust core layer + REST frontend"
```

---

## Phase 3: Configuration & Tooling

### Task 3.1: TypeScript strict mode

**Files:**
- Modify: `tsconfig.app.json`
- Modify: `tsconfig.node.json`
- Modify: various `.ts/.tsx` files (fix strict errors)

- [ ] **Step 1: Enable strict mode in tsconfigs**

In `tsconfig.app.json`, add:
```json
"strict": true,
"noUnusedLocals": true,
"noUnusedParameters": true
```

In `tsconfig.node.json`, add:
```json
"strict": true
```

- [ ] **Step 2: Fix type errors**

Run `pnpm typecheck` and fix any errors exposed by strict mode. Common fixes:
- `obj[key]` where key is `string` → use type assertion or `Record<string, T>`
- Possibly `undefined` returns → add null checks
- `any` typed variables → add explicit types

- [ ] **Step 3: Verify**

```bash
pnpm typecheck  # must pass with zero errors
pnpm lint       # must pass
```

Commit.

---

### Task 3.2: Dependency cleanup

**Files:**
- Modify: `package.json`
- Delete: `package-lock.json`
- Delete: `pnpm-workspace.yaml` (if empty)

- [ ] **Step 1: Remove esbuild dependency**

In `package.json`, remove `"esbuild"` from `devDependencies`.

- [ ] **Step 2: Add scripts**

```json
"typecheck": "tsc -b",
"clean": "rm -rf dist"
```

- [ ] **Step 3: Delete stale files**

```bash
rm package-lock.json
# If pnpm-workspace.yaml only contains the esbuild allow-build entry, delete it
rm pnpm-workspace.yaml
```

- [ ] **Step 4: Reinstall and verify**

```bash
pnpm install
pnpm typecheck
pnpm build
```

Commit.

---

### Task 3.3: CI/CD workflow

**Files:**
- Create: `.github/workflows/ci.yml`

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm build

  backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with:
          components: clippy
      - uses: Swatinem/rust-cache@v2
      - name: Install system deps
        run: sudo apt-get update && sudo apt-get install -y libasound2-dev libgtk-3-dev libwebkit2gtk-4.1-dev
      - run: cargo check --workspace
        working-directory: src-tauri
      - run: cargo clippy --workspace -- -D warnings
        working-directory: src-tauri
      - run: cargo test --workspace
        working-directory: src-tauri
```

- [ ] **Step 2: Verify CI locally**

```bash
pnpm lint && pnpm typecheck && pnpm build
cd src-tauri && cargo check && cargo clippy && cargo test
```

Commit.

---

### Task 3.4: Miscellaneous config fixes

**Files:**
- Modify: `vite.config.ts` — unify boolean coercion
- Modify: `index.html` — add favicon link
- Modify: `.gitignore` — clean up

- [ ] **Step 1: Fix vite.config.ts**

Change from:
```typescript
minify: !process.env.TAURI_DEBUG,
sourcemap: !!process.env.TAURI_DEBUG,
```
To:
```typescript
minify: process.env.TAURI_DEBUG !== 'true',
sourcemap: process.env.TAURI_DEBUG === 'true',
```

- [ ] **Step 2: Add favicon to index.html**

Add inside `<head>`:
```html
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
```

- [ ] **Step 3: Clean .gitignore**

Remove: `nul`, the `Electron build output` section. Add `.env`.

- [ ] **Step 4: Verify**

```bash
pnpm build
```

Commit.

---

## Phase 4: Deep Architecture

### Task 4.1: PlayerContext Ref/State cleanup

**Files:**
- Modify: `src/contexts/PlayerContext.tsx`

- [ ] **Step 1: Convert refs to state**

Change these refs to `useState`:
```typescript
// Before:
const playlistRef = useRef<string[]>([]);
const currentIndexRef = useRef<number>(-1);
const lrcPathRef = useRef<string>('');

// After:
const [playlist, setPlaylist] = useState<string[]>([]);
const [currentIndex, setCurrentIndex] = useState<number>(-1);
const [lrcPath, setLrcPath] = useState<string>('');
```

Remove `isPlayingRef` (keep only `isPlaying` state).

Keep as refs (performance-sensitive, polled frequently):
- `durationRef`
- `currentTimeRef`
- `autoNextGuardRef`

- [ ] **Step 2: Update all consumers**

Replace all `.current` accesses on the converted refs with direct state reads. Replace `.current = value` with `setState(value)`. Ensure the context value exposes the state versions:

```typescript
<PlayerContext.Provider value={{
  playlist,      // now from useState — always current
  currentIndex,  // now from useState — always current
  // ...
}}>
```

- [ ] **Step 3: Verify**

```bash
pnpm typecheck && pnpm build
pnpm tauri dev
# Test: play tracks, verify NowPlaying shows correct info, verify list command shows correct playlist
```

Verify `NowPlaying.tsx:13` — `player.playlist[player.currentIndex]` now reads fresh state correctly.

Commit.

---

### Task 4.2: PlaylistContext ↔ PlayerContext decoupling

**Files:**
- Modify: `src/contexts/PlaylistContext.tsx`
- Modify: `src/contexts/PlayerContext.tsx`

- [ ] **Step 1: Remove PlayerSync interface**

Remove `PlayerSync` interface (lines 7-11) and `playerSyncRef` from PlaylistContext.

- [ ] **Step 2: Replace with direct API calls**

Where PlaylistContext used to call `playerSyncRef.current.clearPlaylist()` / `addToPlaylist()`, instead expose methods that PlayerContext can subscribe to or call through the bridge:

Simplest approach: Give PlaylistContext a `getPlaylistTracks(name: string): string[]` method. PlayerContext directly calls this when switching playlists.

```typescript
// In PlaylistContext:
const getPlaylistTracks = useCallback((name: string): string[] | null => {
  const pl = playlists[name];
  return pl ? pl.tracks : null;
}, [playlists]);
```

```typescript
// In PlayerContext's switchPlaylist equivalent:
const tracks = playlistCtx.getPlaylistTracks(name);
if (tracks) {
  setPlaylist(tracks);
  setCurrentIndex(-1);
}
```

- [ ] **Step 3: Update App.tsx initialization**

Remove the `reloadFromStore` call that bridges PlaylistContext into PlayerContext. Instead, PlayerContext reads the current playlist directly from PlaylistContext after initialization.

- [ ] **Step 4: Verify**

```bash
pnpm typecheck && pnpm build
# Test: cd <playlist>, switch between playlists, verify track list updates
```

Commit.

---

### Task 4.3: Create SafeHtml component

**Files:**
- Create: `src/components/SafeHtml.tsx`
- Modify: `src/components/Terminal.tsx:26` — use SafeHtml
- Modify: `src/components/SelectList.tsx:86` — use SafeHtml

- [ ] **Step 1: Create SafeHtml component**

```typescript
import { memo } from 'react';

const ALLOWED_TAGS = ['cmd', 'kv', 'list', 'span'];

interface SafeHtmlProps {
  html: string;
  className?: string;
}

function parseSafeHtml(html: string): string {
  // Escape all HTML, then unescape only whitelisted tags
  let escaped = html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Restore whitelisted tags
  for (const tag of ALLOWED_TAGS) {
    escaped = escaped
      .replace(new RegExp(`&lt;${tag}\\b`, 'g'), `<${tag}`)
      .replace(new RegExp(`&lt;/${tag}&gt;`, 'g'), `</${tag}>`);
    // Handle self-closing tags and attributes
    escaped = escaped.replace(
      new RegExp(`&lt;${tag}([^&]*?)&gt;`, 'g'),
      (_, attrs) => {
        const decoded = attrs.replace(/&quot;/g, '"').replace(/&#x27;/g, "'");
        return `<${tag}${decoded}>`;
      }
    );
    escaped = escaped.replace(
      new RegExp(`&lt;/${tag}&gt;`, 'g'),
      `</${tag}>`
    );
  }

  return escaped;
}

export const SafeHtml = memo(function SafeHtml({ html, className }: SafeHtmlProps) {
  const safe = parseSafeHtml(html);
  return <span className={className} dangerouslySetInnerHTML={{ __html: safe }} />;
});
```

- [ ] **Step 2: Use SafeHtml in Terminal.tsx**

Replace line 26:
```typescript
// Before:
<span dangerouslySetInnerHTML={{ __html: line.text }} />

// After:
<SafeHtml html={line.text} />
```

- [ ] **Step 3: Use SafeHtml in SelectList.tsx**

Replace the `dangerouslySetInnerHTML` usage (line 86) with `<SafeHtml html={...} />`.

- [ ] **Step 4: Verify**

```bash
pnpm typecheck && pnpm build
pnpm tauri dev
# Test: all commands print correctly, no XSS via file names with <script> tags
```

Commit.

---

### Task 4.4: Replace 200ms delays with waitFor utility

**Files:**
- Create: `src/utils/waitFor.ts`
- Modify: `src/contexts/PlayerContext.tsx` — 3 locations with setTimeout(200)
- Modify: `src/App.tsx` — 1 location with setTimeout(200)

- [ ] **Step 1: Create waitFor utility**

```typescript
export function waitFor<T>(
  getter: () => T | null | undefined,
  timeout = 3000,
  interval = 20
): Promise<T> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      const value = getter();
      if (value != null) return resolve(value);
      if (Date.now() - start > timeout) return reject(new Error('waitFor timeout'));
      setTimeout(check, interval);
    };
    check();
  });
}
```

- [ ] **Step 2: Replace delays in PlayerContext**

Find 3 occurrences of `setTimeout(..., 200)` patterns:
1. Lines 109-121 (initialization tick)
2. Lines 485-502 (lyrics floating toggle)

Replace with `waitFor`:
```typescript
// Before:
setTimeout(() => {
  // ... check/set vertical config
}, 200);

// After:
await waitFor(() => document.getElementById('lyrics-container'), 3000);
// ... then set config
```

- [ ] **Step 3: Replace delay in App.tsx**

Find the setTimeout(200) in AppInitializer (lines 96-118). Replace with `waitFor`.

- [ ] **Step 4: Verify**

```bash
pnpm typecheck && pnpm build
pnpm tauri dev
# Test: app starts normally, lyrics floating window works, theme sync works
```

Commit.

---

### Task 4.5: Add tests

**Files:**
- Create: `src/utils/__tests__/fuzzy.test.ts`
- Create: `src/utils/__tests__/format.test.ts`
- Create: `src/utils/__tests__/lrc.test.ts`
- Create: `src/utils/__tests__/guards.test.ts`
- Modify: `package.json` — add vitest script

- [ ] **Step 1: Setup Vitest**

```bash
pnpm add -D vitest
```

Add to `package.json`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 2: Create `src/utils/__tests__/guards.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { hasError } from '../guards';

describe('hasError', () => {
  it('returns true for objects with error string', () => {
    expect(hasError({ error: 'fail' })).toBe(true);
    expect(hasError({ error: '' })).toBe(true);
  });
  it('returns false for success objects', () => {
    expect(hasError({ data: 'ok' })).toBe(false);
    expect(hasError({})).toBe(false);
  });
  it('returns false for non-objects', () => {
    expect(hasError(null)).toBe(false);
    expect(hasError('string')).toBe(false);
    expect(hasError(42)).toBe(false);
  });
});
```

- [ ] **Step 3: Create remaining test files**

`fuzzy.test.ts` — test exact match, partial match, no match.
`format.test.ts` — test `formatTime`, `escapeHtml`, `getFileName`.
`lrc.test.ts` — test `parseLRC` with valid LRC text, `getCurrentLineIdx`.

- [ ] **Step 4: Run tests**

```bash
pnpm test
```

All must pass.

- [ ] **Step 5: Add Rust tests**

In `src-tauri/src/core/`, add `#[cfg(test)] mod tests` blocks:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    
    #[test]
    fn test_read_metadata() {
        // Requires a test audio file — skip if not available in CI
    }

    #[test]
    fn test_lrc_parse() {
        use crate::lrc_parser::parse_lrc;
        let lines = parse_lrc("[00:01.50]Hello\n[00:05.00]World");
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].time_ms, 1500);
        assert_eq!(lines[0].text, "Hello");
    }
}
```

Run: `cargo test --workspace` — all pass.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "refactor: phase 4 — deep architecture fixes + tests"
```

```
