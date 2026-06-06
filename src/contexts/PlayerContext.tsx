import { createContext, useContext, useRef, useState, useCallback, useEffect, type ReactNode } from 'react';
import type { PlayMode, LyricsMode, LrcLine } from '../types';
import { getStoredSettings } from './SettingsContext';
import { parseLRC, getCurrentLineIdx } from '../utils/lrc';

function hasError(obj: unknown): obj is { error: string } {
  return typeof obj === 'object' && obj !== null && 'error' in obj;
}

interface PlayerContextValue {
  // Playlist
  playlist: string[];
  currentIndex: number;
  getPlaylist: () => string[];
  addToPlaylist: (paths: string[]) => void;
  clearPlaylist: () => void;
  // Playback
  play: () => void;
  pause: () => void;
  toggle: () => void;
  stop: () => void;
  playIndex: (idx: number) => string | undefined;
  next: () => string | undefined;
  prev: () => string | undefined;
  seek: (secs: number) => void;
  setVolume: (v: number) => void;
  getVolume: () => number;
  getCurrentTime: () => number;
  getDuration: () => number;
  isPlaying: boolean;
  // Mode
  playMode: PlayMode;
  setPlayMode: (mode: PlayMode) => void;
  cyclePlayMode: () => PlayMode;
  // State
  currentTime: number;
  duration: number;
  volume: number;
  // Lyrics
  lyricsLines: LrcLine[];
  lyricsVisible: boolean;
  lyricsMode: LyricsMode;
  setLyricsVisible: (v: boolean) => void;
  setLyricsMode: (m: LyricsMode) => void;
  toggleLyrics: () => void;
  loadLRC: (mp3Path: string) => Promise<boolean>;
  updateLyrics: (currentTime: number) => void;
  // Progress bar
  progressFilled: string;
  progressEmpty: string;
  progressWidth: number;
  // Callbacks
  onEndedCallbacks: Array<() => void>;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

export function PlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playlistRef = useRef<string[]>([]);
  const currentIndexRef = useRef(-1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(80);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playMode, setPlayModeState] = useState<PlayMode>('normal');
  const [lyricsLines, setLyricsLines] = useState<LrcLine[]>([]);
  const [lyricsVisible, setLyricsVisibleState] = useState(false);
  const [lyricsMode, setLyricsModeState] = useState<LyricsMode>('floating');
  const lastPrintedIdxRef = useRef(-1);
  const shuffleStackRef = useRef<number[]>([]);
  const endedCallbacksRef = useRef<Array<() => void>>([]);

  const playModeRef = useRef<PlayMode>('normal');
  const lyricsModeRef = useRef<LyricsMode>('floating');

  // Initialize from saved settings
  useEffect(() => {
    const s = getStoredSettings();
    if (s.volume != null) {
      setVolumeState(s.volume);
      if (audioRef.current) audioRef.current.volume = s.volume / 100;
    }
    if (s.lyricsMode) {
      setLyricsModeState(s.lyricsMode);
      lyricsModeRef.current = s.lyricsMode;
    }
    setLyricsVisibleState(s.lyricsVisible);
    // Progress bar settings
  }, []);

  const nextShuffleIndex = useCallback(() => {
    if (playlistRef.current.length === 0) return -1;
    if (shuffleStackRef.current.length === 0) {
      const pool: number[] = [];
      for (let i = 0; i < playlistRef.current.length; i++) {
        if (i !== currentIndexRef.current) pool.push(i);
      }
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      shuffleStackRef.current = pool;
    }
    return shuffleStackRef.current.pop() ?? -1;
  }, []);

  const playIndex = useCallback((idx: number) => {
    if (idx < 0 || idx >= playlistRef.current.length) return undefined;
    currentIndexRef.current = idx;
    const fp = playlistRef.current[idx];
    if (audioRef.current) {
      audioRef.current.src = 'file:///' + fp.replace(/\\/g, '/').replace(/^([A-Z]):/, '$1:');
      audioRef.current.play();
    }
    return fp;
  }, []);

  const addToPlaylist = useCallback((paths: string[]) => {
    for (const p of paths) {
      if (!playlistRef.current.includes(p)) playlistRef.current.push(p);
    }
  }, []);

  const clearPlaylist = useCallback(() => {
    playlistRef.current.length = 0;
    currentIndexRef.current = -1;
  }, []);

  const play = useCallback(() => { audioRef.current?.play(); }, []);
  const pause = useCallback(() => { audioRef.current?.pause(); }, []);
  const toggle = useCallback(() => {
    audioRef.current?.paused ? audioRef.current?.play() : audioRef.current?.pause();
  }, []);
  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    shuffleStackRef.current = [];
  }, []);

  const next = useCallback(() => {
    if (playlistRef.current.length === 0) return undefined;
    if (playModeRef.current === 'shuffle') {
      const idx = nextShuffleIndex();
      if (idx < 0) return undefined;
      return playIndex(idx);
    }
    const idx = (currentIndexRef.current + 1) % playlistRef.current.length;
    return playIndex(idx);
  }, [playIndex, nextShuffleIndex]);

  const prev = useCallback(() => {
    if (playlistRef.current.length === 0) return undefined;
    const idx = (currentIndexRef.current - 1 + playlistRef.current.length) % playlistRef.current.length;
    return playIndex(idx);
  }, [playIndex]);

  const seek = useCallback((secs: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = Math.max(0, Math.min(audioRef.current.duration || 0, secs));
    }
  }, []);

  const setVolume = useCallback((v: number) => {
    const vol = Math.max(0, Math.min(1, v / 100));
    if (audioRef.current) audioRef.current.volume = vol;
    setVolumeState(v);
  }, []);

  const getVolume = useCallback(() => Math.round((audioRef.current?.volume ?? 0.8) * 100), []);
  const getCurrentTime = useCallback(() => audioRef.current?.currentTime ?? 0, []);
  const getDuration = useCallback(() => audioRef.current?.duration ?? 0, []);

  const setPlayMode = useCallback((mode: PlayMode) => {
    playModeRef.current = mode;
    setPlayModeState(mode);
    shuffleStackRef.current = [];
  }, []);

  const cyclePlayMode = useCallback((): PlayMode => {
    const modes: PlayMode[] = ['normal', 'repeat-one', 'repeat-all', 'shuffle'];
    const idx = modes.indexOf(playModeRef.current);
    const next = modes[(idx + 1) % modes.length];
    playModeRef.current = next;
    setPlayModeState(next);
    shuffleStackRef.current = [];
    return next;
  }, []);

  // Lyrics methods
  const loadLRC = useCallback(async (mp3Path: string): Promise<boolean> => {
    setLyricsLines([]);
    lastPrintedIdxRef.current = -1;

    const filename = mp3Path.split(/[/\\]/).pop()!.replace(/\.[^.]+$/, '.lrc');
    const lrcPath = mp3Path.replace(/\.[^.]+$/, '.lrc');
    let result: string | { error: string } = await window.musicPlayer.readFile(lrcPath);

    if (hasError(result)) {
      const s = getStoredSettings();
      const musicFolder = s.musicFolder || '';
      if (musicFolder) {
        const lrcFolderPath = musicFolder.replace(/[/\\]$/, '') + '/lrc/' + filename;
        const folderResult = await window.musicPlayer.readFile(lrcFolderPath);
        if (!hasError(folderResult)) result = folderResult;
      }
    }

    if (hasError(result)) {
      const dir = mp3Path.substring(0, Math.max(mp3Path.lastIndexOf('/'), mp3Path.lastIndexOf('\\')));
      if (dir) {
        const siblingLrcPath = dir + '/lrc/' + filename;
        const siblingResult = await window.musicPlayer.readFile(siblingLrcPath);
        if (!hasError(siblingResult)) result = siblingResult;
      }
    }

    if (hasError(result)) {
      if (lyricsVisible && lyricsModeRef.current === 'floating') {
        window.musicPlayer.sendLyricsUpdate({ prev: '', current: '', next: '' });
      }
      return false;
    }
    const lines = parseLRC(result as string);
    setLyricsLines(lines);
    return lines.length > 0;
  }, [lyricsVisible]);

  const sendLyricsToFloating = useCallback((time: number) => {
    if (lyricsLines.length === 0) {
      window.musicPlayer.sendLyricsUpdate({ prev: '', current: '', next: '' });
      return;
    }
    const curIdx = getCurrentLineIdx(lyricsLines, time);
    const prev = curIdx > 0 ? lyricsLines[curIdx - 1].text : '';
    const current = curIdx >= 0 ? lyricsLines[curIdx].text : '';
    const next = curIdx >= 0 && curIdx < lyricsLines.length - 1 ? lyricsLines[curIdx + 1].text : '';
    window.musicPlayer.sendLyricsUpdate({ prev, current, next });
  }, [lyricsLines]);

  const updateLyrics = useCallback((time: number) => {
    if (!lyricsVisible || lyricsLines.length === 0) return;
    if (lyricsModeRef.current === 'floating') {
      sendLyricsToFloating(time);
      return;
    }
    // Terminal mode is handled by commands via printLine
  }, [lyricsVisible, lyricsLines, sendLyricsToFloating]);

  const setLyricsVisible = useCallback(async (val: boolean) => {
    setLyricsVisibleState(val);
    if (val && lyricsModeRef.current === 'floating') {
      try { await window.musicPlayer.showFloatingLyrics(); } catch {}
    } else if (!val && lyricsModeRef.current === 'floating') {
      try { await window.musicPlayer.hideFloatingLyrics(); } catch {}
    }
  }, []);

  const setLyricsMode = useCallback(async (mode: LyricsMode) => {
    const prevMode = lyricsModeRef.current;
    lyricsModeRef.current = mode;
    setLyricsModeState(mode);

    if (prevMode === 'floating' && mode !== 'floating') {
      try { await window.musicPlayer.hideFloatingLyrics(); } catch {}
    }
    if (mode === 'off') {
      setLyricsVisibleState(false);
    } else {
      setLyricsVisibleState(true);
      if (mode === 'floating') {
        try { await window.musicPlayer.showFloatingLyrics(); } catch {}
      }
    }
    getStoredSettings();
  }, []);

  const toggleLyrics = useCallback(async () => {
    const prevMode = lyricsModeRef.current;
    let newMode: LyricsMode;
    if (lyricsModeRef.current === 'off') newMode = 'floating';
    else if (lyricsModeRef.current === 'floating') newMode = 'terminal';
    else newMode = 'off';

    lyricsModeRef.current = newMode;
    setLyricsModeState(newMode);

    if (prevMode === 'floating' && newMode !== 'floating') {
      try { await window.musicPlayer.hideFloatingLyrics(); } catch {}
    }
    if (newMode === 'off') setLyricsVisibleState(false);
    else {
      setLyricsVisibleState(true);
      if (newMode === 'floating') {
        try { await window.musicPlayer.showFloatingLyrics(); } catch {}
      }
    }
  }, []);

  // Audio element setup
  const audioElement = useRef(<audio
    ref={audioRef}
    id="audio"
    playsInline
    onTimeUpdate={() => {
      const t = audioRef.current?.currentTime ?? 0;
      setCurrentTime(t);
    }}
    onLoadedMetadata={() => {
      setDuration(audioRef.current?.duration ?? 0);
    }}
    onPlay={() => setIsPlaying(true)}
    onPause={() => setIsPlaying(false)}
    onEnded={() => {
      if (playModeRef.current === 'repeat-one') {
        playIndex(currentIndexRef.current);
      } else if (playModeRef.current === 'shuffle') {
        const idx = nextShuffleIndex();
        if (idx >= 0) playIndex(idx);
      } else if (playModeRef.current === 'repeat-all') {
        playIndex((currentIndexRef.current + 1) % playlistRef.current.length);
      } else {
        const nextTrack = currentIndexRef.current + 1;
        if (nextTrack < playlistRef.current.length) playIndex(nextTrack);
      }
      endedCallbacksRef.current.forEach(fn => fn());
    }}
    onError={() => {
      const code = audioRef.current?.error?.code ?? '';
      // Error is handled via command output
    }}
  />);

  // Restore volume on audio element ready
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume / 100;
    }
  }, []);

  const s = getStoredSettings();

  const getPlaylist = useCallback(() => playlistRef.current, []);

  return (
    <PlayerContext.Provider value={{
      playlist: playlistRef.current,
      currentIndex: currentIndexRef.current,
      getPlaylist,
      addToPlaylist, clearPlaylist,
      play, pause, toggle, stop, playIndex, next, prev, seek,
      setVolume, getVolume, getCurrentTime, getDuration,
      isPlaying,
      playMode, setPlayMode, cyclePlayMode,
      currentTime, duration, volume,
      lyricsLines, lyricsVisible, lyricsMode,
      setLyricsVisible, setLyricsMode, toggleLyrics,
      loadLRC, updateLyrics,
      progressFilled: s.progressFilled,
      progressEmpty: s.progressEmpty,
      progressWidth: s.progressWidth,
      onEndedCallbacks: endedCallbacksRef.current,
    }}>
      {audioElement.current}
      {children}
    </PlayerContext.Provider>
  );
}

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer must be used within PlayerProvider');
  return ctx;
}
