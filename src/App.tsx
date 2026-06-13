import { useEffect, useRef } from 'react';
import { SettingsProvider, SHADOW_PRESETS, applyCssVars } from './contexts/SettingsContext';
import { PlaylistProvider, usePlaylists, type PlayerSync } from './contexts/PlaylistContext';
import { PlayerProvider, usePlayer } from './contexts/PlayerContext';
import { TerminalProvider, useTerminal } from './contexts/TerminalContext';
import { TitleBar } from './components/TitleBar';
import { BackgroundLayer } from './components/BackgroundLayer';
import { Terminal } from './components/Terminal';
import { SelectList } from './components/SelectList';
import { NowPlaying } from './components/NowPlaying';
import { InputLine } from './components/InputLine';
import { FloatingLyrics } from './components/FloatingLyrics';
import { getStoredSettings } from './contexts/SettingsContext';
import { initConfig, setMusicFolder, saveSettings } from './configStore';
import { getBridge, isBridgeAvailable, initBridge } from './bridge';

function AppInitializer({ children }: { children: React.ReactNode }) {
  const player = usePlayer();
  const playlists = usePlaylists();
  const terminal = useTerminal();
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    // Initialize bridge first (detects Tauri/Electron environment)
    // Initialize bridge and load config.
    async function startup() {
      await initBridge();

      // Wire contexts together.
      const sync: PlayerSync = {
        addToPlaylist: player.addToPlaylist,
        clearPlaylist: player.clearPlaylist,
        getPlaylist: player.getPlaylist,
      };
      playlists.registerPlayerSync(sync);
      player.registerLyricPrinter((text, cls) => terminal.printLine(text, cls));
      playlists.ensureDefault();

      // Auto-detect music folder BEFORE loading config files.
      // Must await completion so initConfig() sees the folder path.
      const s = getStoredSettings();
      if (!s.musicFolder && isBridgeAvailable()) {
        try {
          const folder = await getBridge().getDefaultMusicDir();
          if (folder) {
            const exists = await getBridge().dirExists(folder);
            if (exists) {
              const stored = getStoredSettings();
              stored.musicFolder = folder;
              setMusicFolder(folder);
              await saveSettings(stored);
            }
          }
        } catch { /* browser mode */ }
      }

      // Now load config from files.  musicFolder is set if available.
      const fileSettings = await initConfig();
      if (fileSettings) {
        applyCssVars(fileSettings);
      }

      // Refresh playlists from file-loaded config.
      playlists.reloadFromStore();
      const reloadedPl = playlists.getCurrentPlaylist();
      if (reloadedPl && reloadedPl.tracks && reloadedPl.tracks.length > 0) {
        player.clearPlaylist();
        player.addToPlaylist(reloadedPl.tracks);
      } else {
        // Fall back to in-memory cache (populated from localStorage at module load).
        const pl = playlists.getCurrentPlaylist();
        if (pl && pl.tracks && pl.tracks.length > 0) {
          player.clearPlaylist();
          player.addToPlaylist(pl.tracks);
        }
      }

      // Restore settings from the updated cache.
      const s2 = getStoredSettings();
      if (s2.volume != null) player.setVolume(s2.volume);
      if (s2.lyricsTerminal) {
        await player.setLyricsTerminal(true);
      }
      if (s2.lyricsFloating) {
        await player.setLyricsFloating(true);
      }
    }

    startup();
  }, []);

  // Force-sync lyrics settings 200ms after startup (blunt but reliable)
  useEffect(() => {
    const timer = setTimeout(() => {
      const s = getStoredSettings();
      const baseFonts = '"Consolas", "Courier New", "Fira Code", monospace';
      if (isBridgeAvailable()) {
        getBridge().sendLyricsTheme({
        font: s.customFont ? `"${s.customFont}", ${baseFonts}` : baseFonts,
        fontSize: s.fontSize || 14, fg: s.fg, fgDim: s['fg-dim'],
        accent: s.accent, bg: s.bg,
        lyricsAccent: s.lyricsAccent || '#b1b9f9',
        lyricsFg: s.lyricsFg || '#cccccc',
        lyricsNextCount: s.lyricsNextCount || 1,
        lyricsGap: s.lyricsGap || 10,
        lyricsShadow: SHADOW_PRESETS[s.lyricsShadow] || '0 0 10px rgba(0,0,0,0.85)',
        lyricsAlign: s.lyricsAlign || 'center',
        lyricsCurrentSize: s.lyricsCurrentSize || 24,
        lyricsNextSize: s.lyricsNextSize || 14,
        lyricsVertical: { off: 'horizontal-tb', rl: 'vertical-rl', lr: 'vertical-lr' }[s.lyricsVertical || 'off'],
        });
      }
    }, 200);
    return () => clearTimeout(timer);
  }, []);

  return <>{children}</>;
}

export default function App() {
  const isLyricsWindow = window.location.hash === '#/lyrics';

  if (isLyricsWindow) {
    return <FloatingLyrics />;
  }

  return (
    <SettingsProvider>
      <PlaylistProvider>
        <PlayerProvider>
          <TerminalProvider>
            <AppInitializer>
              <BackgroundLayer />
              <TitleBar />
              <Terminal />
              <NowPlaying />
              <SelectList />
              <InputLine />
            </AppInitializer>
          </TerminalProvider>
        </PlayerProvider>
      </PlaylistProvider>
    </SettingsProvider>
  );
}
