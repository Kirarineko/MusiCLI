### Task 2.7 Report: Reduce bridge/tauri.ts

**Status**: Done

**What was done**:

- Removed all data/audio methods from `src/bridge/tauri.ts` that are now handled by `src/bridge/http.ts` (25+ methods: `listAudioFiles`, `findLrc`, `readLrcOffsets`, `writeLrcOffset`, `readMetadata`, `readFile`, `readFileBase64`, `writeFile`, `dirExists`, `readConfig`, `writeConfig`, `copyFile`, `mkdir`, `createZip`, `extractZip`, `loadTrack`, `audioPlay`, `audioPause`, `audioStop`, `audioSeek`, `setVolume`, `getPosition`, `getDuration`, `setAudioMode`, `getAudioMode`, `listAudioDevices`)

- Kept only Tauri-native methods (18 methods): `selectFiles`, `selectImage`, `selectFolder`, `selectFont`, `saveFileDialog`, `openThemeDialog`, `selectSyncFile` (file dialogs), `minimize`, `close`, `getDefaultMusicDir` (window ops), `showFloatingLyrics`, `hideFloatingLyrics`, `setLyricsMouseEvents`, `autoSizeLyrics`, `sendLyricsUpdate`, `sendLyricsTheme`, `onLyricsUpdate`, `onLyricsTheme` (floating lyrics)

- Removed the `: IBridge` type annotation from `tauriBridge` export since it no longer satisfies the full interface; the hybrid bridge (`src/bridge/hybrid.ts`) spreads both `tauriBridge` and `httpBridge`, with `httpBridge` providing the missing data/audio methods

- Kept `IBridge` as the comprehensive combined interface in `src/bridge/index.ts` — all callers use `getBridge()` which returns `IBridge`, and the hybrid spread structurally satisfies it

**Verification**:
```
$ npx tsc -b && pnpm build
# No errors, build succeeds
```
