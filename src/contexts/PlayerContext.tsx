import { createContext, useContext, useRef, useState, useCallback, useEffect, type ReactNode } from 'react';
import type { PlayMode, LrcLine } from '../types';
import { getStoredSettings, SHADOW_PRESETS, useSettings } from './SettingsContext';
import { saveSettings as saveSettingsToStore } from '../configStore';
import { parseLRC, getCurrentLineIdx } from '../utils/lrc';
import { getBridge } from '../bridge';

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
  const settings = useSettings();
  const [playlist, setPlaylist] = useState<string[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(-1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(80);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playMode, setPlayModeState] = useState<PlayMode>('normal');
  const [lyricsLines, setLyricsLines] = useState<LrcLine[]>([]);
  const [lyricsTerminal, setLyricsTerminalState] = useState(false);
  const [lyricsFloating, setLyricsFloatingState] = useState(false);
  const [lrcPath, setLrcPath] = useState<string>('');
  const lyricsTerminalRef = useRef(false);
  const lyricsFloatingRef = useRef(false);
  const lastPrintedIdxRef = useRef(-1);
  const lastSentFloatingIdxRef = useRef(-1);
  const shuffleStackRef = useRef<number[]>([]);
  const endedCallbacksRef = useRef<Array<() => void>>([]);
  const loadLrcRef = useRef<((path: string) => void) | null>(null);
  const lyricPrinterRef = useRef<((text: string, className?: string) => void) | null>(null);
  const durationRef = useRef(0);
  const currentTimeRef = useRef(0);
  const autoNextGuardRef = useRef(false);

  const registerLyricPrinter = useCallback((fn: (text: string, className?: string) => void) => {
    lyricPrinterRef.current = fn;
  }, []);

  const playModeRef = useRef<PlayMode>('normal');

  // Initialize from saved settings
  useEffect(() => {
    const s = getStoredSettings();
    if (s.volume != null) {
      setVolumeState(s.volume);
      try { getBridge().setVolume(s.volume); } catch {}
    }
    if (s.lyricsTerminal) {
      setLyricsTerminalState(true);
      lyricsTerminalRef.current = true;
    }
    if (s.lyricsFloating) {
      setLyricsFloatingState(true);
      lyricsFloatingRef.current = true;
      try { getBridge().showFloatingLyrics(); } catch {}
      // Force-refresh floating lyrics config
      setTimeout(() => {
        const cycle: Array<'off' | 'rl' | 'lr'> = ['off', 'rl', 'lr'];
        const cur = getStoredSettings().lyricsVertical || 'off';
        let step = 0;
        const tick = () => {
          step++;
          const next = cycle[(cycle.indexOf(cur as 'off'|'rl'|'lr') + step) % 3];
          settings.saveSettings({ lyricsVertical: next });
          if (step < 3) setTimeout(tick, 150);
        };
        tick();
      }, 600);
    }
  }, []);

  const nextShuffleIndex = useCallback(() => {
    if (playlist.length === 0) return -1;
    if (shuffleStackRef.current.length === 0) {
      const pool: number[] = [];
      for (let i = 0; i < playlist.length; i++) {
        if (i !== currentIndex) pool.push(i);
      }
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      shuffleStackRef.current = pool;
    }
    return shuffleStackRef.current.pop() ?? -1;
  }, [playlist, currentIndex]);

  // Play a track via Rust audio engine (async, fire-and-forget from sync context)
  const playTrackAsync = useCallback(async (fp: string) => {
    try {
      const dur = await getBridge().loadTrack(fp);
      setDuration(dur);
      durationRef.current = dur;
      setCurrentTime(0);
      currentTimeRef.current = 0;
      await getBridge().audioPlay(fp);
      setIsPlaying(true);
    } catch (e) {
      console.error('[player] playTrackAsync error:', e);
    }
  }, []);

  const playIndex = useCallback((idx: number) => {
    if (idx < 0 || idx >= playlist.length) return undefined;
    setCurrentIndex(idx);
    const fp = playlist[idx];
    playTrackAsync(fp);
    return fp;
  }, [playlist, playTrackAsync]);

  const addToPlaylist = useCallback((paths: string[]) => {
    setPlaylist(prev => {
      const toAdd = paths.filter(p => !prev.includes(p));
      return toAdd.length > 0 ? [...prev, ...toAdd] : prev;
    });
  }, []);

  const clearPlaylist = useCallback(() => {
    setPlaylist([]);
    setCurrentIndex(-1);
  }, []);

  const play = useCallback(() => {
    const fp = playlist[currentIndex];
    if (fp) {
      getBridge().audioPlay(fp).then(() => {
        setIsPlaying(true);
      }).catch(() => {});
    }
  }, [playlist, currentIndex]);

  const pause = useCallback(() => {
    getBridge().audioPause().then(() => {
      setIsPlaying(false);
    }).catch(() => {});
  }, []);

  const toggle = useCallback(() => {
    if (isPlaying) {
      pause();
    } else {
      play();
    }
  }, [isPlaying, play, pause]);

  const stop = useCallback(() => {
    getBridge().audioStop().then(() => {
      setIsPlaying(false);
      setCurrentTime(0);
      currentTimeRef.current = 0;
      shuffleStackRef.current = [];
    }).catch(() => {});
  }, []);

  const next = useCallback(() => {
    if (playlist.length === 0) return undefined;
    if (playModeRef.current === 'shuffle') {
      const idx = nextShuffleIndex();
      if (idx < 0) return undefined;
      return playIndex(idx);
    }
    const idx = (currentIndex + 1) % playlist.length;
    return playIndex(idx);
  }, [playlist, currentIndex, playIndex, nextShuffleIndex]);

  const prev = useCallback(() => {
    if (playlist.length === 0) return undefined;
    const idx = (currentIndex - 1 + playlist.length) % playlist.length;
    return playIndex(idx);
  }, [playlist, currentIndex, playIndex]);

  const seek = useCallback((secs: number) => {
    getBridge().audioSeek(secs).then(() => {
      setCurrentTime(secs);
      currentTimeRef.current = secs;
    }).catch(() => {});
  }, []);

  const setVolume = useCallback((v: number) => {
    const vol = Math.max(0, Math.min(100, v));
    setVolumeState(vol);
    getBridge().setVolume(vol).catch(() => {});
  }, []);

  const getVolume = useCallback(() => volume, [volume]);
  const getCurrentTime = useCallback(() => currentTimeRef.current, []);
  const getDuration = useCallback(() => durationRef.current, []);

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

  // Polling: update position from Rust audio engine every 100ms
  useEffect(() => {
    if (!isPlaying) return;

    const interval = setInterval(async () => {
      try {
        const pos = await getBridge().getPosition();
        const dur = await getBridge().getDuration();

        if (dur > 0 && durationRef.current !== dur) {
          setDuration(dur);
          durationRef.current = dur;
        }

        setCurrentTime(pos);
        currentTimeRef.current = pos;

        // Release auto-next guard when new track playback has begun
        if (pos < dur - 0.5 && autoNextGuardRef.current) {
          autoNextGuardRef.current = false;
        }

        // Check if track ended (position >= duration and duration > 0)
        if (dur > 0 && pos >= dur - 0.1) {
          if (autoNextGuardRef.current) return;
          autoNextGuardRef.current = true;
          // Track ended — handle play mode
          if (playModeRef.current === 'repeat-one') {
            playIndex(currentIndex);
          } else if (playModeRef.current === 'shuffle') {
            const idx = nextShuffleIndex();
            if (idx >= 0) playIndex(idx);
          } else if (playModeRef.current === 'repeat-all') {
            playIndex((currentIndex + 1) % playlist.length);
          } else {
            const nextTrack = currentIndex + 1;
            if (nextTrack < playlist.length) {
              playIndex(nextTrack);
            } else {
              setIsPlaying(false);
            }
          }
          // Load lyrics for new track
          const fp = playlist[currentIndex];
          if (fp && loadLrcRef.current) loadLrcRef.current(fp);
          endedCallbacksRef.current.forEach(fn => fn());
        }
      } catch {
        // Bridge not available
      }
    }, 100);

    return () => clearInterval(interval);
  }, [isPlaying, playlist, currentIndex, playIndex, nextShuffleIndex]);

  // Lyrics methods
  const loadLRC = useCallback(async (mp3Path: string): Promise<boolean> => {
    setLyricsLines([]);
    lastPrintedIdxRef.current = -1;
    lastSentFloatingIdxRef.current = -1;

    const filename = mp3Path.split(/[/\\]/).pop()!.replace(/\.[^.]+$/, '.lrc');
    const candidatePath = mp3Path.replace(/\.[^.]+$/, '.lrc');
    let result: string | { error: string } = await getBridge().readFile(candidatePath);

    // 1. Try lrc/ subfolder in music folder
    if (hasError(result)) {
      const s = getStoredSettings();
      const musicFolder = s.musicFolder || '';
      if (musicFolder) {
        const lrcFolderPath = musicFolder.replace(/[/\\]$/, '') + '/lrc/' + filename;
        const folderResult = await getBridge().readFile(lrcFolderPath);
        if (!hasError(folderResult)) result = folderResult;
      }
    }

    // 2. Try lrc/ subfolder next to the MP3 file
    if (hasError(result)) {
      const dir = mp3Path.substring(0, Math.max(mp3Path.lastIndexOf('/'), mp3Path.lastIndexOf('\\')));
      if (dir) {
        const siblingLrcPath = dir + '/lrc/' + filename;
        const siblingResult = await getBridge().readFile(siblingLrcPath);
        if (!hasError(siblingResult)) result = siblingResult;
      }
    }

    // 3. Recursively scan music folder for matching .lrc
    if (hasError(result)) {
      const s = getStoredSettings();
      const musicFolder = s.musicFolder || '';
      if (musicFolder) {
        const found = await getBridge().findLrc(mp3Path, musicFolder);
        if (found && !hasError(found)) result = await getBridge().readFile(found);
      }
    }

    // 4. Recursively scan MP3's parent directory
    if (hasError(result)) {
      const dir = mp3Path.substring(0, Math.max(mp3Path.lastIndexOf('/'), mp3Path.lastIndexOf('\\')));
      if (dir) {
        const found = await getBridge().findLrc(mp3Path, dir);
        if (found && !hasError(found)) result = await getBridge().readFile(found);
      }
    }

    if (hasError(result)) {
      console.log('[lrc] loadLRC: not found for', mp3Path);
      if (lyricsFloatingRef.current) {
        getBridge().sendLyricsUpdate({ current: '', next: [] });
      }
      return false;
    }
    const lines = parseLRC(result as string);
    // Apply timing offset if configured for this track
    try {
      const parentDir = mp3Path.substring(0, Math.max(mp3Path.lastIndexOf('/'), mp3Path.lastIndexOf('\\')));
      const offsets = await getBridge().readLrcOffsets(parentDir + '/lrc');
      const trackName = (mp3Path.split(/[/\\]/).pop() || '').replace(/\.[^.]+$/, '.lrc');
      if (!hasError(offsets) && offsets[trackName]) {
        for (const l of lines) l.time += offsets[trackName] / 1000;
      }
    } catch { /* offset feature unavailable — ignore */ }
    // Skip past lines if playback is mid-song; reset if track just started
    // or position is stale from a previous track (auto-advance).
    const curPos = currentTimeRef.current;
    const dur = durationRef.current;
    const trackSwitched = mp3Path !== lrcPath;
    setLrcPath(mp3Path);
    if (curPos < 0.5 || curPos > dur + 1.0 || trackSwitched) {
      // Track just started or position is stale — start from beginning.
      lastPrintedIdxRef.current = -1;
      if (trackSwitched) {
        setCurrentTime(0);
        currentTimeRef.current = 0;
      }
    } else {
      const startIdx = getCurrentLineIdx(lines, curPos);
      lastPrintedIdxRef.current = startIdx;
      if (startIdx >= 0 && startIdx < lines.length && lyricsTerminalRef.current) {
        const printFn = lyricPrinterRef.current;
        if (printFn) printFn(lines[startIdx].text, 'lyric');
      }
    }
    console.log('[lrc] loadLRC: found', lines.length, 'lines for', mp3Path,
      'lastIdx:', lastPrintedIdxRef.current, 'curPos:', curPos, 'dur:', dur);
    setLyricsLines(lines);
    return lines.length > 0;
  }, [lrcPath]);
  // Keep ref synced so polling can call loadLRC
  useEffect(() => { loadLrcRef.current = loadLRC; }, [loadLRC]);

  const sendLyricsToFloating = useCallback((time: number) => {
    if (lyricsLines.length === 0) {
      getBridge().sendLyricsUpdate({ current: '', next: [] });
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
    getBridge().sendLyricsUpdate({ current, next });
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
        // Guard against stale time causing bulk-print on track switch
        if (newIdx - lastPrintedIdxRef.current > 10) {
          lastPrintedIdxRef.current = newIdx;
          return;
        }
        for (let i = lastPrintedIdxRef.current + 1; i <= newIdx; i++) {
          printFn(lyricsLines[i].text, i === newIdx ? 'lyric' : 'dim');
        }
        lastPrintedIdxRef.current = newIdx;
      }
    }
  }, [lyricsLines, sendLyricsToFloating]);

  // Drive lyrics from time updates
  useEffect(() => {
    updateLyrics(currentTime);
  }, [currentTime, updateLyrics]);

  // Terminal lyrics toggle
  const setLyricsTerminal = useCallback(async (v: boolean) => {
    lyricsTerminalRef.current = v;
    setLyricsTerminalState(v);
    lastPrintedIdxRef.current = -1;
    if (!v) {
      try { saveSettingsToStore({ ...getStoredSettings(), lyricsTerminal: false }); } catch {}
    } else {
      try { saveSettingsToStore({ ...getStoredSettings(), lyricsTerminal: true }); } catch {}
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
      try { await getBridge().showFloatingLyrics(); } catch {}
      // Force-sync lyrics settings 200ms after opening
      setTimeout(() => {
        const s2 = getStoredSettings();
        const baseFonts = '"Consolas", "Courier New", "Fira Code", monospace';
        getBridge().sendLyricsTheme({
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
          lyricsVertical: { off: 'horizontal-tb', rl: 'vertical-rl', lr: 'vertical-lr' }[s2.lyricsVertical || 'off'],
        });
      }, 200);
    } else {
      try { await getBridge().hideFloatingLyrics(); } catch {}
    }
    try { saveSettingsToStore({ ...getStoredSettings(), lyricsFloating: v }); } catch {}
  }, []);

  const toggleFloatingLyrics = useCallback(async () => {
    await setLyricsFloating(!lyricsFloatingRef.current);
  }, [setLyricsFloating]);

  const s = getStoredSettings();

  const getPlaylist = useCallback(() => playlist, [playlist]);

  return (
    <PlayerContext.Provider value={{
      playlist,
      currentIndex,
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
      {children}
    </PlayerContext.Provider>
  );
}

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer must be used within PlayerProvider');
  return ctx;
}
