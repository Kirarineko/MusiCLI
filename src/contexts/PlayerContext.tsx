import { createContext, useContext, useRef, useState, useCallback, useEffect, type ReactNode } from 'react';
import type { PlayMode, LrcLine } from '../types';
import { getStoredSettings, SHADOW_PRESETS } from './SettingsContext';
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
  lyricsTerminal: boolean;
  lyricsFloating: boolean;
  toggleTerminalLyrics: () => void;
  toggleFloatingLyrics: () => void;
  setLyricsTerminal: (v: boolean) => Promise<void>;
  setLyricsFloating: (v: boolean) => Promise<void>;
  loadLRC: (mp3Path: string) => Promise<boolean>;
  updateLyrics: (currentTime: number) => void;
  // Progress bar
  progressFilled: string;
  progressEmpty: string;
  progressWidth: number;
  // Lyric printing (terminal mode) — registered by AppInitializer
  registerLyricPrinter: (fn: (text: string, className?: string) => void) => void;
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
  const [lyricsTerminal, setLyricsTerminalState] = useState(false);
  const [lyricsFloating, setLyricsFloatingState] = useState(false);
  const lyricsTerminalRef = useRef(false);
  const lyricsFloatingRef = useRef(false);
  const lastPrintedIdxRef = useRef(-1);
  const lastSentFloatingIdxRef = useRef(-1);
  const shuffleStackRef = useRef<number[]>([]);
  const endedCallbacksRef = useRef<Array<() => void>>([]);
  const lyricPrinterRef = useRef<((text: string, className?: string) => void) | null>(null);

  const registerLyricPrinter = useCallback((fn: (text: string, className?: string) => void) => {
    lyricPrinterRef.current = fn;
  }, []);

  const playModeRef = useRef<PlayMode>('normal');

  // Initialize from saved settings
  useEffect(() => {
    const s = getStoredSettings();
    if (s.volume != null) {
      setVolumeState(s.volume);
      if (audioRef.current) audioRef.current.volume = s.volume / 100;
    }
    if (s.lyricsTerminal) {
      setLyricsTerminalState(true);
      lyricsTerminalRef.current = true;
    }
    if (s.lyricsFloating) {
      setLyricsFloatingState(true);
      lyricsFloatingRef.current = true;
      try { window.musicPlayer.showFloatingLyrics(); } catch {}
    }
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
    lastSentFloatingIdxRef.current = -1;

    const filename = mp3Path.split(/[/\\]/).pop()!.replace(/\.[^.]+$/, '.lrc');
    const lrcPath = mp3Path.replace(/\.[^.]+$/, '.lrc');
    let result: string | { error: string } = await window.musicPlayer.readFile(lrcPath);

    // 1. Try lrc/ subfolder in music folder
    if (hasError(result)) {
      const s = getStoredSettings();
      const musicFolder = s.musicFolder || '';
      if (musicFolder) {
        const lrcFolderPath = musicFolder.replace(/[/\\]$/, '') + '/lrc/' + filename;
        const folderResult = await window.musicPlayer.readFile(lrcFolderPath);
        if (!hasError(folderResult)) result = folderResult;
      }
    }

    // 2. Try lrc/ subfolder next to the MP3 file
    if (hasError(result)) {
      const dir = mp3Path.substring(0, Math.max(mp3Path.lastIndexOf('/'), mp3Path.lastIndexOf('\\')));
      if (dir) {
        const siblingLrcPath = dir + '/lrc/' + filename;
        const siblingResult = await window.musicPlayer.readFile(siblingLrcPath);
        if (!hasError(siblingResult)) result = siblingResult;
      }
    }

    // 3. Recursively scan music folder for matching .lrc
    if (hasError(result)) {
      const s = getStoredSettings();
      const musicFolder = s.musicFolder || '';
      if (musicFolder) {
        const found = await window.musicPlayer.findLrc(mp3Path, musicFolder);
        if (found && !hasError(found)) result = await window.musicPlayer.readFile(found);
      }
    }

    // 4. Recursively scan MP3's parent directory
    if (hasError(result)) {
      const dir = mp3Path.substring(0, Math.max(mp3Path.lastIndexOf('/'), mp3Path.lastIndexOf('\\')));
      if (dir) {
        const found = await window.musicPlayer.findLrc(mp3Path, dir);
        if (found && !hasError(found)) result = await window.musicPlayer.readFile(found);
      }
    }

    if (hasError(result)) {
      console.log('[lrc] loadLRC: not found for', mp3Path);
      if (lyricsFloatingRef.current) {
        window.musicPlayer.sendLyricsUpdate({ current: '', next: [] });
      }
      return false;
    }
    const lines = parseLRC(result as string);
    console.log('[lrc] loadLRC: found', lines.length, 'lines for', mp3Path);
    setLyricsLines(lines);
    return lines.length > 0;
  }, []);

  const sendLyricsToFloating = useCallback((time: number) => {
    if (lyricsLines.length === 0) {
      window.musicPlayer.sendLyricsUpdate({ current: '', next: [] });
      return;
    }
    const curIdx = getCurrentLineIdx(lyricsLines, time);
    if (curIdx === lastSentFloatingIdxRef.current) return;
    lastSentFloatingIdxRef.current = curIdx;
    const current = curIdx >= 0 ? lyricsLines[curIdx].text : '';
    const count = getStoredSettings().lyricsNextCount || 1;
    const next: string[] = [];
    for (let i = 1; i <= count && curIdx + i < lyricsLines.length; i++) {
      next.push(lyricsLines[curIdx + i].text);
    }
    window.musicPlayer.sendLyricsUpdate({ current, next });
  }, [lyricsLines]);

  const updateLyrics = useCallback((time: number) => {
    if (lyricsLines.length === 0) return;
    if (lyricsFloatingRef.current) {
      sendLyricsToFloating(time);
    }
    if (lyricsTerminalRef.current) {
      const printFn = lyricPrinterRef.current;
      if (!printFn) return;
      let newIdx = lastPrintedIdxRef.current;
      for (let i = lastPrintedIdxRef.current + 1; i < lyricsLines.length; i++) {
        if (lyricsLines[i].time <= time) {
          newIdx = i;
        } else break;
      }
      if (newIdx > lastPrintedIdxRef.current) {
        for (let i = lastPrintedIdxRef.current + 1; i <= newIdx; i++) {
          printFn(lyricsLines[i].text, i === newIdx ? 'lyric' : 'dim');
        }
        lastPrintedIdxRef.current = newIdx;
      }
    }
  }, [lyricsLines, sendLyricsToFloating]);

  // Terminal lyrics toggle
  const setLyricsTerminal = useCallback(async (v: boolean) => {
    lyricsTerminalRef.current = v;
    setLyricsTerminalState(v);
    lastPrintedIdxRef.current = -1;
    if (!v) {
      try { localStorage.setItem('musiccli-settings', JSON.stringify({ ...getStoredSettings(), lyricsTerminal: false })); } catch {}
    } else {
      try { localStorage.setItem('musiccli-settings', JSON.stringify({ ...getStoredSettings(), lyricsTerminal: true })); } catch {}
    }
  }, []);

  const toggleTerminalLyrics = useCallback(async () => {
    await setLyricsTerminal(!lyricsTerminalRef.current);
  }, [setLyricsTerminal]);

  // Floating lyrics toggle (also syncs current theme on open)
  const setLyricsFloating = useCallback(async (v: boolean) => {
    lyricsFloatingRef.current = v;
    setLyricsFloatingState(v);
    if (v) {
      try { await window.musicPlayer.showFloatingLyrics(); } catch {}
      // Force-sync lyrics settings 200ms after opening (blunt but reliable)
      setTimeout(() => {
        const s2 = getStoredSettings();
        const baseFonts = '"Consolas", "Courier New", "Fira Code", monospace';
        window.musicPlayer.sendLyricsTheme({
          font: s2.customFont ? `"${s2.customFont}", ${baseFonts}` : baseFonts,
          fontSize: s2.fontSize || 14, fg: s2.fg, fgDim: s2['fg-dim'],
          accent: s2.accent, bg: s2.bg,
          lyricsAccent: s2.lyricsAccent || '#b1b9f9',
          lyricsFg: s2.lyricsFg || '#cccccc',
          lyricsNextCount: s2.lyricsNextCount || 1,
          lyricsGap: s2.lyricsGap || 10,
          lyricsShadow: SHADOW_PRESETS[s2.lyricsShadow] || SHADOW_PRESETS.medium,
          lyricsAlign: s2.lyricsAlign || 'center',
          lyricsCurrentSize: s2.lyricsCurrentSize || 24,
          lyricsNextSize: s2.lyricsNextSize || 14,
        });
      }, 200);
    } else {
      try { await window.musicPlayer.hideFloatingLyrics(); } catch {}
    }
    try { localStorage.setItem('musiccli-settings', JSON.stringify({ ...getStoredSettings(), lyricsFloating: v })); } catch {}
  }, []);

  const toggleFloatingLyrics = useCallback(async () => {
    await setLyricsFloating(!lyricsFloatingRef.current);
  }, [setLyricsFloating]);

  // Drive lyrics + progress from time updates
  useEffect(() => {
    updateLyrics(currentTime);
  }, [currentTime, updateLyrics]);

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
      lyricsLines, lyricsTerminal, lyricsFloating,
      toggleTerminalLyrics, toggleFloatingLyrics,
      setLyricsTerminal, setLyricsFloating,
      loadLRC, updateLyrics,
      progressFilled: s.progressFilled,
      progressEmpty: s.progressEmpty,
      progressWidth: s.progressWidth,
      registerLyricPrinter,
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
