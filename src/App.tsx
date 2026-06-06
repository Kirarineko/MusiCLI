import { useEffect, useRef } from 'react';
import { SettingsProvider } from './contexts/SettingsContext';
import { PlaylistProvider, usePlaylists, type PlayerSync } from './contexts/PlaylistContext';
import { PlayerProvider, usePlayer } from './contexts/PlayerContext';
import { TerminalProvider } from './contexts/TerminalContext';
import { TitleBar } from './components/TitleBar';
import { BackgroundLayer } from './components/BackgroundLayer';
import { Terminal } from './components/Terminal';
import { SelectList } from './components/SelectList';
import { NowPlaying } from './components/NowPlaying';
import { InputLine } from './components/InputLine';
import { FloatingLyrics } from './components/FloatingLyrics';
import { getStoredSettings } from './contexts/SettingsContext';

function AppInitializer({ children }: { children: React.ReactNode }) {
  const player = usePlayer();
  const playlists = usePlaylists();
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    // Wire PlayerContext functions into PlaylistContext
    const sync: PlayerSync = {
      addToPlaylist: player.addToPlaylist,
      clearPlaylist: player.clearPlaylist,
      getPlaylist: player.getPlaylist,
    };
    playlists.registerPlayerSync(sync);

    playlists.ensureDefault();

    // Load current playlist tracks into player
    const pl = playlists.getCurrentPlaylist();
    if (pl && pl.tracks && pl.tracks.length > 0) {
      player.clearPlaylist();
      player.addToPlaylist(pl.tracks);
    }

    // Auto-detect music folder
    const s = getStoredSettings();
    if (!s.musicFolder) {
      try {
        window.musicPlayer?.getDefaultMusicDir().then(folder => {
          window.musicPlayer?.dirExists(folder).then(exists => {
            if (exists) {
              const stored = getStoredSettings();
              stored.musicFolder = folder;
              localStorage.setItem('musiccli-settings', JSON.stringify(stored));
            }
          });
        });
      } catch { /* browser mode - no musicPlayer */ }
    }

    // Restore volume
    if (s.volume != null) player.setVolume(s.volume);

    // Restore lyrics
    if (s.lyricsVisible && s.lyricsMode === 'floating') {
      player.setLyricsMode(s.lyricsMode);
    }
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
