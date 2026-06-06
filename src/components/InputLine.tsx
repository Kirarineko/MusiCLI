import { useRef, useEffect, useCallback } from 'react';
import { useTerminal, filterItems, getVisibleIdxFn } from '../contexts/TerminalContext';
import { usePlayer } from '../contexts/PlayerContext';
import { usePlaylists } from '../contexts/PlaylistContext';
import { useSettings } from '../contexts/SettingsContext';
import { getCommand } from '../commands/registry';
import { setCommandContext, registerAllCommands, type CommandContext } from '../commands/handlers';
import { escapeHtml } from '../utils/format';
import { t } from '../i18n';

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

    lyricsVisible: player.lyricsVisible,
    toggleLyrics: player.toggleLyrics,
    setLyricsMode: player.setLyricsMode,

    saveSettings: (partial) => settings.saveSettings(partial),
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

  // Register commands once
  useEffect(() => {
    registerAllCommands();
  }, []);

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
        const result = await window.musicPlayer.readMetadata(fp);
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

    // Normal mode
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

  const placeholder = terminal.selectMode ? t('selectHint') : '';

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
