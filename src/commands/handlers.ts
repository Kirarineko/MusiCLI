import { register } from './registry';
import { t } from '../i18n';
import { getStoredSettings } from '../contexts/SettingsContext';
import { fuzzySearch } from '../utils/fuzzy';
import { escapeHtml, getFileName } from '../utils/format';
import { darken } from '../utils/color';
import type { SelectCandidate, InteractiveItem, MetadataResult, Theme, LyricsMode } from '../types';

function hasError(obj: unknown): obj is { error: string } {
  return typeof obj === 'object' && obj !== null && 'error' in obj;
}

// These will be set by the app initialization
let _ctx: CommandContext | null = null;

export interface CommandContext {
  printLine: (text: string, className?: string) => void;
  printRaw: (text: string) => void;
  printKV: (title: string | null, pairs: [string, string | number | null][]) => void;
  printList: (title: string | null, items: { name: string; meta?: string; sub?: string; highlight?: boolean }[]) => void;
  printHelp: () => void;
  clearTerminal: () => void;
  enterSelectMode: (candidates: SelectCandidate[]) => void;
  exitSelectMode: () => void;
  enterImode: (mode: 'import' | 'track-pl', items: InteractiveItem[], cb: (selected: InteractiveItem[]) => void) => void;
  exitImode: () => void;

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
  lyricsVisible: boolean;
  toggleLyrics: () => void;
  setLyricsMode: (m: import('../types').LyricsMode) => void;

  // Settings
  saveSettings: (partial: Record<string, unknown>) => void;
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
  getPlaylistData: (name: string) => import('../types').Playlist | null;
  createPlaylist: (name: string, desc?: string) => { success: boolean; error?: string };
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
}

export function setCommandContext(ctx: CommandContext) {
  _ctx = ctx;
}

function ctx(): CommandContext {
  if (!_ctx) throw new Error('Command context not initialized');
  return _ctx;
}

async function readMetadata(filePath: string): Promise<MetadataResult | null> {
  const result = await window.musicPlayer.readMetadata(filePath);
  if (result.error) {
    ctx().printLine(t('metadataError', { err: result.error }), 'error');
    return null;
  }
  return result as MetadataResult;
}

function printNowPlaying(meta: MetadataResult) {
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

function showMetadata(meta: MetadataResult | null) {
  if (!meta) return;
  const durationStr = meta.duration
    ? Math.floor(meta.duration / 60) + ':' + String(Math.floor(meta.duration % 60)).padStart(2, '0')
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

// --- Helper sub-handlers ---

const COLOR_TYPE_MAP: Record<string, string> = {
  text: 'fg', fg: 'fg', dim: 'fg-dim', 'fg-dim': 'fg-dim',
  bright: 'fg-bright', 'fg-bright': 'fg-bright',
  accent: 'accent', hl: 'accent', bg: 'bg', background: 'bg',
  line: 'line', border: 'line', lyric: 'lyric',
};

function handleVol(args: string[]) {
  const c = ctx();
  const v = parseInt(args[0], 10);
  if (isNaN(v) || v < 0 || v > 100) {
    c.printLine(t('volumeUsage', { v: c.getVolume() }), 'info');
    return;
  }
  c.setVolume(v);
  c.saveSettings({ volume: v });
  c.printLine(t('volumeSet', { v }), 'success');
}

function handleColor(args: string[]) {
  const c = ctx();
  if (args.length === 0) {
    handleShowColors();
    return;
  }
  if (args.length < 2) {
    c.printLine(t('colorUsage'), 'info');
    c.printRaw('  ' + t('colorTypes'));
    c.printRaw('  ' + t('colorExample'));
    return;
  }
  const type = COLOR_TYPE_MAP[args[0].toLowerCase()];
  if (!type) {
    c.printLine(t('colorUnknown', { t: args[0] }), 'error');
    return;
  }
  const color = args[1];
  const validHex = /^#[0-9a-fA-F]{3,8}$/.test(color);
  const validFunc = /^rgba?\s*\(/i.test(color);
  if (!validHex && !validFunc) {
    c.printLine(t('colorInvalid'), 'error');
    return;
  }
  let fullColor = color;
  if (/^#[0-9a-fA-F]{3}$/.test(color)) {
    fullColor = '#' + color[1] + color[1] + color[2] + color[2] + color[3] + color[3];
  }
  const partial: Record<string, unknown> = {};
  partial[type] = fullColor;
  if (type === 'bg') partial['bg-darker'] = darken(fullColor, 0.85);
  c.saveSettings(partial);
  c.printLine(t('colorSet', { type: args[0], hex: fullColor }), 'success');
}

function handleShowColors() {
  const s = getStoredSettings();
  ctx().printKV(t('colorsTitle'), [
    [t('tableBg'), s.bg],
    [t('tableText'), s.fg],
    [t('tableDim'), s['fg-dim']],
    [t('tableBright'), s['fg-bright']],
    [t('tableAccent'), s.accent],
    [t('tableLine'), s.line],
    [t('tableLyric'), s.lyric],
    [t('tableBlur'), s['bg-blur'] + 'px'],
    [t('tableImage'), s['bg-img'] ? t('tableYes') : t('tableNone')],
  ]);
}

async function handleBg(args: string[]) {
  const c = ctx();
  if (args[0] === 'clear' || args[0] === 'none' || args[0] === 'off') {
    c.saveSettings({ 'bg-img': '', 'bg-img-data': '' });
    c.printLine(t('bgCleared'), 'info');
    return;
  }
  const imgPath = await window.musicPlayer.selectImage();
  if (!imgPath) { c.printLine(t('bgNoImage'), 'info'); return; }
  c.saveSettings({ 'bg-img': imgPath });
  c.printLine(t('bgSet'), 'success');
}

function handleBlur(args: string[]) {
  const c = ctx();
  const v = parseInt(args[0], 10);
  if (isNaN(v) || v < 0 || v > 50) {
    c.printLine(t('blurUsage', { v: getStoredSettings()['bg-blur'] || 0 }), 'info');
    return;
  }
  c.saveSettings({ 'bg-blur': v });
  c.printLine(t('blurSet', { v }), 'success');
}

async function handleFont(args: string[]) {
  const c = ctx();
  const sub = (args[0] || '').toLowerCase();
  const s = getStoredSettings();
  if (sub === 'size') {
    const v = parseInt(args[1], 10);
    if (isNaN(v) || v < 10 || v > 32) { c.printLine(t('fontSizeUsage', { v: s.fontSize || 14 }), 'info'); return; }
    c.saveSettings({ fontSize: v });
    c.printLine(t('fontSizeSet', { v }), 'success');
  } else if (sub === 'weight') {
    const raw = args[1];
    if (!raw) { c.printLine(t('fontWeightUsage', { v: s.fontWeight || 400 }), 'info'); return; }
    const weightMap: Record<string, number> = { normal: 400, bold: 700, lighter: 300, bolder: 600 };
    let w = weightMap[raw.toLowerCase()] ?? parseInt(raw, 10);
    if (isNaN(w) || w < 100 || w > 900) { c.printLine(t('fontWeightUsage', { v: s.fontWeight || 400 }), 'info'); return; }
    c.saveSettings({ fontWeight: w });
    c.printLine(t('fontWeightSet', { v: w }), 'success');
  } else if (sub === 'import') {
    const fontPath = await window.musicPlayer.selectFont();
    if (!fontPath) { c.printLine(t('fontNoSelect'), 'info'); return; }
    const base64 = await window.musicPlayer.readFileBase64(fontPath);
    if (hasError(base64)) { c.printLine(t('fontImportSelect'), 'error'); return; }
    const ext = fontPath.split('.').pop()!.toLowerCase();
    const mimeMap: Record<string, string> = { ttf: 'font/truetype', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2' };
    const mime = mimeMap[ext] || 'font/truetype';
    const dataUrl = `data:${mime};base64,${base64}`;
    const fontName = fontPath.split(/[/\\]/).pop()!.replace(/\.[^.]+$/, '');
    c.saveSettings({ customFont: fontName, customFontData: dataUrl });
    c.printLine(t('fontImported', { name: fontName }), 'success');
  } else if (sub === 'clear' || sub === 'reset') {
    c.saveSettings({ customFont: '', customFontData: '' });
    c.printLine(t('fontReset'), 'info');
  } else {
    c.printLine(t('helpFont'), 'info');
  }
}

// --- Register all commands ---

export function registerAllCommands() {
  // open
  register('open', ['load'], async (args) => {
    const c = ctx();
    if (args[0] === 'dir' || args[0] === 'folder') {
      const dirPath = await window.musicPlayer.selectFolder();
      if (!dirPath) { c.printLine(t('folderNoSelect'), 'info'); return; }
      const files = await window.musicPlayer.listAudioFiles(dirPath);
      if (hasError(files)) { c.printLine(t('metadataError', { err: files.error }), 'error'); return; }
      if (!files || files.length === 0) { c.printLine(t('folderEmpty'), 'info'); return; }
      c.replaceCurrentTracks(files);
      const dirName = dirPath.split(/[/\\]/).pop() || dirPath;
      c.printLine(`<cmd>${escapeHtml(dirName)} (${files.length} ${t('tracks')})</cmd>`, 'accent');
      for (let i = 0; i < files.length; i++) {
        c.printRaw(`  ${i + 1}. ${getFileName(files[i])}`);
      }
      c.saveSettings({ musicFolder: dirPath });
      c.printLine(t('folderLoaded', { n: files.length }) + '  ' + t('typePlay'), 'info');
      return;
    }
    const files = await window.musicPlayer.selectFiles();
    if (files.length === 0) { c.printLine(t('noFiles'), 'info'); return; }
    c.addTracksToCurrent(files);
    const fp = c.playIndex(c.playlist.indexOf(files[0]));
    if (fp) {
      const meta = await readMetadata(fp);
      if (meta) { printNowPlaying(meta); await c.loadLRC(fp); }
    }
    c.printLine(t('addedFiles', { n: files.length }), 'info');
  }, 'helpOpen');

  // cd
  register('cd', [], async (args) => {
    const c = ctx();
    if (args.length === 0) {
      const info = c.getCurrentPlaylist();
      if (info) {
        c.printLine(t('cdCurrent', { name: info.name }), 'info');
        c.printRaw('  ' + info.desc);
        c.printRaw('  ' + info.tracks.length + ' ' + t('tracks'));
      }
      return;
    }
    const name = args.join(' ');
    const result = c.switchPlaylist(name);
    if (!result) {
      c.printLine(t('cdNoMatch', { name }), 'error');
    } else if ((result as { candidates: string[] }).candidates) {
      c.printLine(t('cdCandidates', { name }), 'info');
      for (const n of (result as { candidates: string[] }).candidates) c.printRaw('  - ' + n);
    } else {
      const pl = result as { name: string; tracks: string[] };
      c.printLine(t('cdSwitched', { name: pl.name, n: pl.tracks.length }), 'success');
    }
  }, 'helpCd');

  // folder
  register('folder', ['dir', 'opendir'], async () => {
    const c = ctx();
    const dirPath = await window.musicPlayer.selectFolder();
    if (!dirPath) { c.printLine(t('folderNoSelect'), 'info'); return; }
    const files = await window.musicPlayer.listAudioFiles(dirPath);
    if ('error' in files) { c.printLine(t('metadataError', { err: files.error }), 'error'); return; }
    if (!files || files.length === 0) { c.printLine(t('folderEmpty'), 'info'); return; }
    c.replaceCurrentTracks(files);
    c.saveSettings({ musicFolder: dirPath });
    c.printLine(t('folderLoaded', { n: files.length }) + '  ' + t('typePlay'), 'info');
  }, 'helpFolder');

  // import
  register('import', ['batch'], async () => {
    const c = ctx();
    let folder = getStoredSettings().musicFolder || '';
    if (!folder) folder = await window.musicPlayer.getDefaultMusicDir();
    const exists = folder ? await window.musicPlayer.dirExists(folder) : false;
    if (!exists || !folder) { c.printLine(t('importNoFolder'), 'info'); return; }
    const files = await window.musicPlayer.listAudioFiles(folder);
    if (hasError(files) || !files || files.length === 0) { c.printLine(t('importNoFiles'), 'info'); return; }
    const items: InteractiveItem[] = files.map(f => ({
      name: getFileName(f), path: f, selected: false, visible: true,
    }));
    c.enterImode('import', items, (selected) => {
      if (selected.length > 0) {
        const tracks = selected.map(s => s.path!);
        c.addTracksToCurrent(tracks);
        c.printLine(t('importDone', { n: tracks.length, pl: c.getCurrentPlName() }), 'success');
      }
    });
  }, 'helpImport');

  // track
  register('track', ['t'], (args) => {
    const c = ctx();
    const sub = (args[0] || '').toLowerCase();
    const pl = c.playlist;
    if (pl.length === 0) { c.printLine(t('playlistEmpty'), 'info'); return; }
    const num = parseInt(args[1], 10);
    if (isNaN(num) || num < 1 || num > pl.length) { c.printLine(t('trackInvalidNum'), 'error'); return; }
    const trackPath = pl[num - 1];
    const trackName = getFileName(trackPath);

    if (sub === 'info') {
      c.printKV(t('trackInfoTitle') + ': ' + trackName, [[t('trackPath'), trackPath]]);
      const inPls = c.getPlaylistsForTrack(trackPath);
      c.printLine(t('trackInPlaylists') + ': ' + (inPls.length > 0 ? inPls.join(', ') : '-'), 'info');
      const allPls = c.listAllPlaylists().map(p => p.name);
      const notIn = allPls.filter(n => !inPls.includes(n));
      if (notIn.length > 0) c.printLine(t('trackNotInPlaylists') + ': ' + notIn.join(', '), 'dim');
    } else if (sub === 'pl' || sub === 'edit') {
      const inPls = c.getPlaylistsForTrack(trackPath);
      const allNames = c.listAllPlaylists().map(p => p.name);
      const items: InteractiveItem[] = allNames.map(name => ({
        name, selected: inPls.includes(name), visible: true,
      }));
      c.enterImode('track-pl', items, (selected) => {
        c.syncTrackToPlaylists(trackPath, selected.map(s => s.name));
        c.printLine(t('trackPlUpdated'), 'success');
      });
    } else {
      c.printLine(t('helpTrack'), 'info');
    }
  }, 'helpTrack');

  // play
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
        if (fp) {
          const meta = await readMetadata(fp);
          if (meta) { printNowPlaying(meta); await c.loadLRC(fp); }
        }
        c.printLine(t('playing'), 'success');
      }
      return;
    }

    const arg = args.join(' ');
    if (/^\d+$/.test(arg)) {
      const num = parseInt(arg, 10);
      if (num < 1 || num > pl.length) { c.printLine(t('invalidIndex', { n: num, max: pl.length }), 'error'); return; }
      const fp = c.playIndex(num - 1);
      if (fp) {
        const meta = await readMetadata(fp);
        if (meta) { printNowPlaying(meta); await c.loadLRC(fp); }
        c.printLine(t('playing'), 'success');
      }
      return;
    }

    const results = fuzzySearch(arg, pl);
    if (results.length === 0) { c.printLine(t('noMatch', { q: arg }), 'error'); return; }
    if (results.length === 1) {
      const fp = c.playIndex(results[0].idx);
      if (fp) {
        const meta = await readMetadata(fp);
        if (meta) { printNowPlaying(meta); await c.loadLRC(fp); }
        c.printLine(t('playing'), 'success');
      }
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
    const meta = await readMetadata(fp);
    if (meta) printNowPlaying(meta);
    await c.loadLRC(fp);
    c.printLine(t('skippedNext'), 'success');
  }, 'helpNext');

  register('prev', ['p', 'back', 'previous'], async () => {
    const c = ctx();
    const fp = c.prev();
    if (!fp) { c.printLine(t('noPrevTrack'), 'info'); return; }
    const meta = await readMetadata(fp);
    if (meta) printNowPlaying(meta);
    await c.loadLRC(fp);
    c.printLine(t('backPrev'), 'success');
  }, 'helpPrev');

  register('info', ['meta', 'metadata'], async () => {
    const c = ctx();
    if (c.currentIndex < 0) { c.printLine(t('noTrackLoaded'), 'info'); return; }
    const meta = await readMetadata(c.playlist[c.currentIndex]);
    showMetadata(meta);
  }, 'helpInfo');

  register('list', ['ls'], () => {
    const c = ctx();
    const pl = c.playlist;
    if (pl.length === 0) { c.printLine(t('playlistEmpty'), 'info'); return; }
    c.printLine(`<cmd>${t('playlist')} (${pl.length} ${t('tracks')}):</cmd>`, 'accent');
    for (let i = 0; i < pl.length; i++) {
      const marker = i === c.currentIndex ? '>' : ' ';
      c.printRaw(`  ${marker} ${i + 1}. ${getFileName(pl[i])}`);
    }
  }, 'helpList');

  register('lyric', ['lyrics', 'lrc'], (args) => {
    const c = ctx();
    const sub = (args[0] || '').toLowerCase();
    if (sub === 'floating' || sub === 'float' || sub === 'desktop') {
      c.setLyricsMode('floating');
      c.printLine(t('lyricsFloatingOn'), 'success');
    } else if (sub === 'terminal' || sub === 'term' || sub === 'inline') {
      c.setLyricsMode('terminal');
      c.printLine(t('lyricsTerminalOn'), 'success');
    } else if (sub === 'off' || sub === 'hide' || sub === 'disable') {
      c.setLyricsMode('off');
      c.printLine(t('lyricsOff'), 'info');
    } else if (!sub) {
      c.toggleLyrics();
    } else {
      c.printLine(t('lyricUsage'), 'info');
    }
  }, 'helpLyric');

  register('progress', ['bar'], (args) => {
    const c = ctx();
    const sub = (args[0] || '').toLowerCase();
    const rest = args.slice(1);
    const s = getStoredSettings();

    if (sub === 'width') {
      const v = parseInt(rest[0], 10);
      if (isNaN(v) || v < 10 || v > 100) { c.printLine(t('progressWidthUsage', { v: s.progressWidth || 20 }), 'info'); return; }
      c.saveSettings({ progressWidth: v });
      c.printLine(t('progressWidthSet', { v }), 'success');
    } else if (sub === 'char' || sub === 'chars') {
      if (rest.length < 2) { c.printLine(t('progressCharUsage'), 'info'); return; }
      c.saveSettings({ progressFilled: rest[0], progressEmpty: rest[1] });
      c.printLine(t('progressCharSet', { f: rest[0], e: rest[1] }), 'success');
    } else {
      c.printLine(t('helpProgressSet'), 'info');
      c.printRaw(`  bar width: ${s.progressWidth ?? 20}`);
      c.printRaw(`  bar char:  "${s.progressFilled ?? '='}" "${s.progressEmpty ?? ' '}"`);
    }
  }, 'helpProgress');

  // set
  register('set', [], async (args) => {
    const c = ctx();
    const sub = (args[0] || '').toLowerCase();
    const rest = args.slice(1);
    if (sub === 'vol' || sub === 'volume') handleVol(rest);
    else if (sub === 'color') handleColor(rest);
    else if (sub === 'colors') handleShowColors();
    else if (sub === 'bg' || sub === 'background') await handleBg(rest);
    else if (sub === 'blur') handleBlur(rest);
    else if (sub === 'font') await handleFont(rest);
    else c.printLine(t('setUsage'), 'info');
  }, 'helpSet');

  // Flat aliases
  register('vol', ['volume'], (args) => handleVol(args), 'helpVol');
  register('color', ['setcolor'], (args) => handleColor(args), 'helpColor');
  register('colors', ['showcolors'], () => handleShowColors(), 'helpColors');
  register('bg', ['background', 'bgimage'], (args) => handleBg(args), 'helpBg');
  register('blur', ['bgblur'], (args) => handleBlur(args), 'helpBlur');
  register('font', [], (args) => handleFont(args), 'helpFont');

  // theme
  register('theme', [], async (args) => {
    const c = ctx();
    const sub = (args[0] || '').toLowerCase();
    const rest = args.slice(1);

    if (sub === 'save') {
      if (rest.length === 0) { c.printLine(t('themeUsage'), 'info'); return; }
      c.saveCurrentTheme(rest.join(' '));
      c.printLine(t('themeSaved', { name: rest.join(' ') }), 'success');
    } else if (sub === 'load' || sub === 'apply' || sub === 'switch') {
      if (rest.length === 0) { c.printLine(t('themeUsage'), 'info'); return; }
      const name = rest.join(' ');
      if (c.applyTheme(name)) c.printLine(t('themeLoaded', { name }), 'success');
      else c.printLine(t('themeNotFound'), 'error');
    } else if (sub === 'list' || sub === 'ls') {
      const names = c.themeNames();
      c.printList(t('themeList') + ' (' + names.length + ')', names.map(n => {
        const theme = c.getTheme(n);
        return { name: n, meta: theme ? theme.fg + '  ' + theme.accent : '', highlight: false };
      }));
    } else if (sub === 'delete' || sub === 'rm' || sub === 'del') {
      if (rest.length === 0) { c.printLine(t('themeUsage'), 'info'); return; }
      const name = rest.join(' ');
      const r = c.deleteTheme(name);
      if (r.error === 'notFound') c.printLine(t('themeNotFound'), 'error');
      else if (r.error === 'builtin') c.printLine(t('themeDeleteBuiltin'), 'error');
      else c.printLine(t('themeDeleted', { name }), 'success');
    } else if (sub === 'export') {
      if (rest.length === 0) { c.printLine(t('themeUsage'), 'info'); return; }
      const name = rest.join(' ');
      const theme = c.exportTheme(name);
      if (!theme) { c.printLine(t('themeNotFound'), 'error'); return; }
      // Add bg-img-data if missing
      if (!theme['bg-img-data']) {
        const s = getStoredSettings();
        const imgPath = s['bg-img'];
        if (imgPath) {
          try {
            const b64 = await window.musicPlayer.readFileBase64(imgPath);
            if (!hasError(b64)) theme['bg-img-data'] = b64;
          } catch { /* ignore */ }
        }
      }
      const jsonStr = JSON.stringify(theme, null, 2);
      const savePath = await window.musicPlayer.saveFileDialog(name + '.json');
      if (!savePath) return;
      const wr = await window.musicPlayer.writeFile(savePath, jsonStr);
      if (wr.error) { c.printLine(wr.error, 'error'); return; }
      c.printLine(t('themeExported'), 'success');
    } else if (sub === 'import') {
      const filePath = await window.musicPlayer.openThemeDialog();
      if (!filePath) return;
      const result = await window.musicPlayer.readFile(filePath);
      if (hasError(result) || !result) { c.printLine(t('themeImportError'), 'error'); return; }
      // Import logic inline
      try {
        const theme = JSON.parse(result);
        if (!theme.name) { c.printLine(t('themeImportError'), 'error'); return; }
        c.saveCurrentTheme(theme.name);
        c.printLine(t('themeImported', { name: theme.name }), 'success');
      } catch { c.printLine(t('themeImportError'), 'error'); }
    } else if (/^\d+$/.test(sub)) {
      const idx = parseInt(sub, 10) - 1;
      const names = c.themeNames();
      if (idx >= 0 && idx < names.length) {
        if (c.applyTheme(names[idx])) c.printLine(t('themeLoaded', { name: names[idx] }), 'success');
      } else c.printLine(t('themeNotFound'), 'error');
    } else if (!sub) {
      const names = c.themeNames();
      if (names.length === 0) { c.printLine(t('themeNotFound'), 'info'); return; }
      c.printLine(`<cmd>${t('themeList')} (${names.length})</cmd>`, 'accent');
      for (let i = 0; i < names.length; i++) {
        const theme = c.getTheme(names[i]);
        const fgSpan = `<span style="color:${theme?.fg ?? '#fff'}">text</span>`;
        const accentSpan = `<span style="color:${theme?.accent ?? '#888'}">accent</span>`;
        c.printLine(`  ${i + 1}. ${names[i]}  [${fgSpan}  ${accentSpan}]`);
      }
      c.printLine(t('themeSwitchHint'), 'dim');
    } else {
      c.printLine(t('themeUsage'), 'info');
    }
  }, 'helpTheme');

  // lang
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

  // help
  register('help', ['?', 'h'], () => ctx().printHelp(), 'helpHelp');

  // clear
  register('clear', ['cls'], () => ctx().clearTerminal(), 'helpClear');

  // pl
  register('pl', [], (args) => {
    const c = ctx();
    const sub = (args[0] || '').toLowerCase();
    const rest = args.slice(1);

    if (sub === 'create' || sub === 'new') {
      if (rest.length === 0) { c.printLine(t('helpPlCreate'), 'info'); return; }
      const name = rest[0];
      const desc = rest.slice(1).join(' ');
      const r = c.createPlaylist(name, desc);
      if (r.error === 'duplicate') c.printLine(t('plDuplicate'), 'error');
      else c.printLine(t('plCreated', { name }), 'success');
    } else if (sub === 'list' || sub === 'ls') {
      const list = c.listAllPlaylists();
      if (list.length === 0) { c.printLine(t('plNoPlaylists'), 'info'); return; }
      c.printList(t('plTitle') + ' (' + String(list.length) + ')', list.map(p => ({
        name: p.name + (p.isCurrent ? ' ' + t('plIsCurrent') : ''),
        meta: p.trackCount + ' ' + t('tracks'),
        sub: (p.desc ? p.desc + '  —  ' : '') + new Date(p.createdAt).toLocaleDateString(),
        highlight: p.isCurrent,
      })));
    } else if (sub === 'delete' || sub === 'rm' || sub === 'del') {
      if (rest.length === 0) { c.printLine(t('helpPlDelete'), 'info'); return; }
      const name = rest.join(' ');
      const r = c.deletePlaylist(name);
      if (r.error === 'notFound') c.printLine(t('plNotFound'), 'error');
      else if (r.error === 'lastOne') c.printLine(t('plLastOne'), 'error');
      else c.printLine(t('plDeleted', { name }), 'success');
    } else if (sub === 'edit') {
      if (rest.length < 3) { c.printLine(t('helpPlEdit'), 'info'); return; }
      const r = c.editPlaylist(rest[0], rest[1], rest.slice(2).join(' '));
      if (r.error === 'notFound') c.printLine(t('plNotFound'), 'error');
      else if (r.error === 'duplicate') c.printLine(t('plDuplicate'), 'error');
      else if (r.error === 'badField') c.printLine(t('plBadField'), 'error');
      else c.printLine(t('plUpdated'), 'success');
    } else if (sub === 'info' || !sub) {
      const name = rest.length > 0 ? rest.join(' ') : c.getCurrentPlName();
      const info = c.getPlaylistData(name);
      if (!info) { c.printLine(t('plNotFound'), 'error'); return; }
      c.printLine(`<cmd>${t('plInfoHeader')}: ${info.name}</cmd>`, 'accent');
      c.printRaw('  ' + t('plDesc') + ': ' + (info.desc || '-'));
      c.printRaw('  ' + t('plTracks') + ': ' + info.tracks.length);
      c.printRaw('  ' + t('plCreated2') + ': ' + new Date(info.createdAt).toLocaleString());
    } else {
      c.printLine(t('unknownCmd', { cmd: escapeHtml('pl ' + sub) }), 'error');
    }
  }, 'helpPlCreate');

  // mode
  register('mode', ['loop', 'repeat'], () => {
    const c = ctx();
    const mode = c.cyclePlayMode();
    const modeKey = 'mode' + mode.charAt(0).toUpperCase() + mode.slice(1).replace(/-./g, x => x[1].toUpperCase());
    c.printLine(t('modeChanged', { mode: t(modeKey) }), 'success');
  }, 'helpMode');

  // quit
  register('quit', ['exit', 'q'], () => window.close(), 'helpQuit');
}
