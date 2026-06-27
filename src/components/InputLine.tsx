import { useRef, useEffect, useCallback } from 'react';
import { useTerminal, filterItems, getVisibleIdxFn } from '../contexts/TerminalContext';
import { usePlayer } from '../contexts/PlayerContext';
import { usePlaylists } from '../contexts/PlaylistContext';
import { useSettings } from '../contexts/SettingsContext';
import { getCommand, getAllCommandNames } from '../commands/registry';
import { subCompletions } from '../commands/completions';
import { setCommandContext, type CommandContext } from '../commands/handlers/index';
import { escapeHtml } from '../utils/format';
import { t } from '../i18n';
import { getBridge } from '../bridge';

function getCommonPrefix(strings: string[]): string {
  if (strings.length === 0) return '';
  let prefix = strings[0];
  for (let i = 1; i < strings.length; i++) {
    while (!strings[i].startsWith(prefix) && prefix.length > 0) {
      prefix = prefix.slice(0, -1);
    }
    if (prefix.length === 0) break;
  }
  return prefix;
}

function replaceWordAtCursor(input: HTMLInputElement, newWord: string) {
  const value = input.value;
  const pos = input.selectionStart ?? value.length;
  const matches = [...value.matchAll(/\S+/g)];
  let targetIdx = -1;
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    if (pos >= m.index! && pos <= m.index! + m[0].length) {
      targetIdx = i;
      break;
    }
  }
  if (targetIdx === -1) return;
  const m = matches[targetIdx];
  const before = value.slice(0, m.index!);
  const after = value.slice(m.index! + m[0].length);
  input.value = before + newWord + after;
  const newPos = before.length + newWord.length;
  input.setSelectionRange(newPos, newPos);
}

export function InputLine() {
  const inputRef = useRef<HTMLInputElement>(null);
  const historyRef = useRef<string[]>([]);
  const historyIdxRef = useRef(-1);

  const terminal = useTerminal();
  const player = usePlayer();
  const playlists = usePlaylists();
  const settings = useSettings();

  // Build command context
  const buildCtx = useCallback((): CommandContext => ({
    printLine: terminal.printLine,
    printRaw: terminal.printRaw,
    printKV: terminal.printKV,
    printList: terminal.printList,
    printHelp: terminal.printHelp,
    clearTerminal: terminal.clearTerminal,
    enterSelectMode: terminal.enterSelectMode,
    exitSelectMode: terminal.exitSelectMode,
    enterImode: terminal.enterImode,
    exitImode: terminal.exitImode,
    enterSeekMode: terminal.enterSeekMode,
    exitSeekMode: terminal.exitSeekMode,

    playlist: player.playlist,
    currentIndex: player.currentIndex,
    getPlaylist: player.getPlaylist,
    addToPlaylist: player.addToPlaylist,
    clearPlaylist: player.clearPlaylist,
    play: player.play,
    pause: player.pause,
    stop: player.stop,
    playIndex: player.playIndex,
    next: player.next,
    prev: player.prev,
    seek: player.seek,
    setVolume: player.setVolume,
    getVolume: player.getVolume,
    getCurrentTime: player.getCurrentTime,
    getDuration: player.getDuration,
    cyclePlayMode: player.cyclePlayMode,
    loadLRC: player.loadLRC,

    lyricsTerminal: player.lyricsTerminal,
    lyricsFloating: player.lyricsFloating,
    toggleTerminalLyrics: player.toggleTerminalLyrics,
    toggleFloatingLyrics: player.toggleFloatingLyrics,
    setLyricsTerminal: player.setLyricsTerminal,
    setLyricsFloating: player.setLyricsFloating,

    saveSettings: (partial) => settings.saveSettings(partial),
    resetSettings: settings.resetSettings,
    applyTheme: (name) => settings.applyTheme(name),

    replaceCurrentTracks: playlists.replaceCurrentTracks,
    addTracksToCurrent: playlists.addTracksToCurrent,
    getCurrentPlName: playlists.getCurrentPlName,
    switchPlaylist: playlists.switchPlaylist,
    getPlaylistsForTrack: playlists.getPlaylistsForTrack,
    syncTrackToPlaylists: playlists.syncTrackToPlaylists,
    listAllPlaylists: playlists.listAllPlaylists,
    getCurrentPlaylist: playlists.getCurrentPlaylist,
    getPlaylistData: playlists.getPlaylistData,
    createPlaylist: playlists.createPlaylist,
    createPlaylistWithTracks: playlists.createPlaylistWithTracks,
    deletePlaylist: playlists.deletePlaylist,
    editPlaylist: playlists.editPlaylist,
    ensureDefault: playlists.ensureDefault,

    themeNames: settings.themeNames,
    getTheme: settings.getTheme,
    saveCurrentTheme: settings.saveCurrentTheme,
    deleteTheme: settings.deleteTheme,
    exportTheme: settings.exportTheme,

    setLangFn: (lang) => settings.setLang(lang),
    syncLyricsTheme: () => {},
  }), [terminal, player, playlists, settings]);

  // Update command context whenever it changes
  useEffect(() => {
    setCommandContext(buildCtx());
  }, [buildCtx]);

  // Auto-focus input on click anywhere
  useEffect(() => {
    const handler = () => inputRef.current?.focus();
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, []);

  // When entering imode, clear input so user can type filter immediately
  useEffect(() => {
    if (terminal.imode) {
      if (inputRef.current) inputRef.current.value = '';
      inputRef.current?.focus();
    }
  }, [terminal.imode]);

  // Sync input value to filter on every input change
  const handleInput = useCallback(() => {
    if (terminal.imode) {
      terminal.updateFilter(inputRef.current?.value ?? '');
    }
  }, [terminal]);

  const executeCommand = useCallback((raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    terminal.printRaw('> ' + trimmed);
    const parts = trimmed.split(/\s+/);
    const cmdName = parts[0].toLowerCase();
    const args = parts.slice(1);
    setCommandContext(buildCtx());
    const cmd = getCommand(cmdName);
    if (cmd) {
      cmd.handler(args);
    } else {
      terminal.printLine(t('unknownCmd', { cmd: escapeHtml(cmdName) }), 'error');
    }
  }, [terminal, buildCtx]);

  const handleSelectConfirm = useCallback(async () => {
    const picked = terminal.selectCandidates[terminal.selectIdx];
    terminal.exitSelectMode();
    if (picked) {
      const ctx = buildCtx();
      setCommandContext(ctx);
      const fp = ctx.playIndex(picked.idx);
      if (fp) {
        const result = await getBridge().readMetadata(fp);
        if (!result.error) {
          ctx.printRaw('');
          ctx.printLine(`<cmd>${t('nowPlaying')}</cmd>`, 'success');
          ctx.printRaw('  ' + result.title);
          await ctx.loadLRC(fp);
        }
        ctx.printLine(t('playing'), 'success');
      }
    }
  }, [terminal, buildCtx]);

  const handleKeyDown = useCallback(async (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Seek mode — arrow keys seek, any other key exits
    if (terminal.seekMode) {
      const s = settings.settings;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const step = s.seekStep || 5;
        const wasPaused = !player.isPlaying;
        if (s.seekPause && !wasPaused) player.pause();
        player.seek(player.getCurrentTime() - step);
        if (s.seekPause && !wasPaused) player.play();
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        const step = s.seekStep || 5;
        const wasPaused = !player.isPlaying;
        if (s.seekPause && !wasPaused) player.pause();
        player.seek(player.getCurrentTime() + step);
        if (s.seekPause && !wasPaused) player.play();
        return;
      }
      // Any other key exits seek mode
      e.preventDefault();
      terminal.exitSeekMode();
      if (inputRef.current) inputRef.current.value = '';
      return;
    }

    // Interactive mode — only intercept special keys, let typing work naturally
    if (terminal.imode) {
      if (e.key === 'ArrowUp') { e.preventDefault(); terminal.moveCursor(-1); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); terminal.moveCursor(1); return; }
      if (e.key === ' ') {
        e.preventDefault();
        const vis = filterItems(terminal.iitems, terminal.ifilter);
        const cur = getVisibleIdxFn(terminal.iitems, terminal.iidx);
        if (cur >= 0 && cur < vis.length) {
          const item = vis[cur];
          const idx = terminal.iitems.indexOf(item);
          if (idx >= 0) terminal.toggleIitem(idx);
        }
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const selected = terminal.iitems.filter(it => it.selected);
        const cb = terminal.imodeCallback;
        terminal.exitImode();
        if (cb) cb(selected);
        return;
      }
      if (e.key === 'Escape') { e.preventDefault(); terminal.exitImode(); return; }
      // All other keys (typing, backspace, delete): let browser handle natively.
      // onInput handler syncs input value → filter in real time.
      return;
    }

    // Fuzzy select mode
    if (terminal.selectMode) {
      if (e.key === 'ArrowUp') { e.preventDefault(); terminal.setSelectIdx(Math.max(0, terminal.selectIdx - 1)); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); terminal.setSelectIdx(Math.min(terminal.selectCandidates.length - 1, terminal.selectIdx + 1)); return; }
      if (e.key === 'Enter') { e.preventDefault(); handleSelectConfirm(); return; }
      if (e.key === 'Escape') { e.preventDefault(); terminal.exitSelectMode(); terminal.printLine(t('selectCancel'), 'info'); return; }
      terminal.exitSelectMode();
    }

    // Tab-completion interactive mode
    if (terminal.completeMode) {
      const candidates = terminal.completeCandidates;
      const idx = terminal.completeIdx;
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        const newIdx = (idx - 1 + candidates.length) % candidates.length;
        terminal.setCompleteIdx(newIdx);
        if (inputRef.current) replaceWordAtCursor(inputRef.current, candidates[newIdx]);
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const newIdx = (idx + 1) % candidates.length;
        terminal.setCompleteIdx(newIdx);
        if (inputRef.current) replaceWordAtCursor(inputRef.current, candidates[newIdx]);
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        const newIdx = (idx + 1) % candidates.length;
        terminal.setCompleteIdx(newIdx);
        if (inputRef.current) replaceWordAtCursor(inputRef.current, candidates[newIdx]);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        terminal.exitCompleteMode();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        terminal.exitCompleteMode();
        return;
      }
      // Any other key: exit completeMode, let it pass through
      terminal.exitCompleteMode();
    }

    // Normal mode — Tab completion
    if (e.key === 'Tab') {
      e.preventDefault();
      const input = inputRef.current;
      if (!input) return;
      const value = input.value;
      const pos = input.selectionStart ?? value.length;

      const wordMatches = [...value.matchAll(/\S+/g)];
      let wordIdx = -1;
      for (let i = 0; i < wordMatches.length; i++) {
        const m = wordMatches[i];
        if (pos >= m.index! && pos <= m.index! + m[0].length) {
          wordIdx = i;
          break;
        }
      }

      const currentWord = wordIdx >= 0 ? wordMatches[wordIdx][0] : '';
      const chain = wordMatches.slice(0, wordIdx).map(m => m[0].toLowerCase()).join(' ');

      const allCandidates: string[] | undefined = chain
        ? subCompletions[chain]
        : getAllCommandNames();

      if (!allCandidates) return;

      if (!currentWord) {
        terminal.enterCompleteMode([...allCandidates].sort());
        return;
      }

      const matches = allCandidates.filter(n => n.startsWith(currentWord.toLowerCase()));
      if (matches.length === 0) return;

      if (matches.length === 1) {
        replaceWordAtCursor(input, matches[0]);
        return;
      }

      const sorted = [...matches].sort();
      terminal.enterCompleteMode(sorted);
      const common = getCommonPrefix(sorted);
      if (common.length > currentWord.length) {
        replaceWordAtCursor(input, common);
      }
      return;
    }

    if (e.key === 'Enter') {
      const cmd = inputRef.current?.value ?? '';
      if (cmd.trim()) {
        historyRef.current.push(cmd);
        historyIdxRef.current = historyRef.current.length;
      }
      executeCommand(cmd);
      if (inputRef.current) inputRef.current.value = '';
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (historyRef.current.length === 0) return;
      historyIdxRef.current = Math.max(0, historyIdxRef.current - 1);
      if (inputRef.current) inputRef.current.value = historyRef.current[historyIdxRef.current] || '';
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyRef.current.length === 0) return;
      historyIdxRef.current = Math.min(historyRef.current.length, historyIdxRef.current + 1);
      if (inputRef.current) inputRef.current.value = historyRef.current[historyIdxRef.current] || '';
    }
  }, [terminal, executeCommand, handleSelectConfirm]);

  const placeholder = terminal.seekMode
    ? t('seekModeHint', { step: settings.settings.seekStep || 5 })
    : terminal.selectMode
    ? t('selectHint')
    : '';

  return (
    <div id="input-line">
      <span id="prompt">&gt;</span>
      <input
        ref={inputRef}
        type="text"
        id="cmd-input"
        autoFocus
        spellCheck={false}
        placeholder={placeholder}
        onKeyDown={handleKeyDown}
        onInput={handleInput}
      />
    </div>
  );
}
