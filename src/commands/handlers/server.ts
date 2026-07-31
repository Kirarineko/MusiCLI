import { register } from '../registry';
import { ctx, sanitizeName, readMetadata, printNowPlaying } from './index';
import { t } from '../../i18n';
import { getBridge } from '../../bridge';
import { getStoredSettings } from '../../contexts/SettingsContext';
import { getServers, saveServers } from '../../configStore';
import { escapeHtml, getFileName, formatTime } from '../../utils/format';
import type { RemoteServer, RemoteSearchHit } from '../../types';

// Active connection + last search results live in module state only —
// they are session-scoped, the server list itself is persisted.
let activeServer: RemoteServer | null = null;
let lastResults: RemoteSearchHit[] = [];

function isTauri(): boolean {
  return typeof window !== 'undefined' && !!(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
}

async function invokeCmd<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

// All remote HTTP goes through Rust (remote_api_get / remote_download) —
// the webview CSP only allows localhost, fetch() would fail in production.
async function apiGet<T>(server: RemoteServer, path: string): Promise<T> {
  const url = server.url.replace(/\/+$/, '') + path;
  return invokeCmd<T>('remote_api_get', { url, token: server.token || '' });
}

function findServer(nameOrIdx: string): RemoteServer | null {
  const servers = getServers();
  const n = parseInt(nameOrIdx, 10);
  if (!isNaN(n) && n >= 1 && n <= servers.length) return servers[n - 1];
  return servers.find(s => s.name.toLowerCase() === nameOrIdx.toLowerCase()) || null;
}

/** Rebuild an LRC file from the parsed lines returned by /lyrics/parse. */
function linesToLrc(lines: { time: number; text: string }[]): string {
  return lines.map(l => {
    const mm = String(Math.floor(l.time / 60)).padStart(2, '0');
    const ss = (l.time % 60).toFixed(2).padStart(5, '0');
    return `[${mm}:${ss}]${l.text}`;
  }).join('\n');
}

/**
 * Ensure a remote track exists locally under {musicFolder}/remote/<server>/.
 * Reuses the local copy when its sha256 matches the server's; otherwise
 * downloads (with progress lines) and pulls the LRC alongside.
 * Returns the local absolute path.
 */
async function ensureDownloaded(server: RemoteServer, hit: RemoteSearchHit): Promise<string> {
  const c = ctx();
  const mf = getStoredSettings().musicFolder || '';
  if (!mf) throw new Error(t('importNoFolder'));

  const destDir = `${mf.replace(/[/\\]$/, '')}/remote/${sanitizeName(server.name)}`;
  const dest = `${destDir}/${hit.name}`;

  // Compare hashes: local hash fails when the file doesn't exist yet.
  let localSha: string | null = null;
  try {
    localSha = await invokeCmd<string>('file_sha256', { path: dest });
  } catch { /* not downloaded yet */ }
  if (localSha) {
    try {
      const remote = await apiGet<{ sha256: string }>(server, `/files/hash?path=${encodeURIComponent(hit.path)}`);
      if (remote.sha256 === localSha) {
        c.printLine(t('serverCacheHit', { name: escapeHtml(hit.name) }), 'dim');
        return dest;
      }
    } catch { /* hash endpoint failed — re-download to be safe */ }
  }

  // Download with progress (10% steps).
  c.printLine(t('serverDownloading', { name: escapeHtml(hit.name) }), 'info');
  const { listen } = await import('@tauri-apps/api/event');
  let lastPct = -10;
  const unlisten = await listen<{ dest: string; received: number; total: number }>(
    'remote-download-progress',
    (event) => {
      const p = event.payload;
      if (p.dest !== dest || p.total <= 0) return;
      const pct = Math.min(100, Math.floor((p.received / p.total) * 100));
      if (pct >= lastPct + 10) {
        lastPct = pct;
        ctx().printLine(`  ${pct}%  (${(p.received / 1048576).toFixed(1)} / ${(p.total / 1048576).toFixed(1)} MB)`, 'dim');
      }
    },
  );
  try {
    const url = `${server.url.replace(/\/+$/, '')}/stream?path=${encodeURIComponent(hit.path)}&download=true`;
    await invokeCmd('remote_download', { url, token: server.token || '', destPath: dest });
  } finally {
    unlisten();
  }
  c.printLine(t('serverDownloaded', { name: escapeHtml(hit.name) }), 'success');

  // Best-effort: pull lyrics next to the cached file so find_lrc picks it up.
  try {
    const lines = await apiGet<{ time: number; text: string }[]>(
      server, `/lyrics/parse?audio_path=${encodeURIComponent(hit.path)}`,
    );
    if (Array.isArray(lines) && lines.length > 0) {
      const stem = hit.name.replace(/\.[^.]+$/, '');
      await getBridge().writeFile(`${destDir}/${stem}.lrc`, linesToLrc(lines));
    }
  } catch { /* no lyrics on the server */ }

  return dest;
}

function printSearchResults(hits: RemoteSearchHit[]) {
  const c = ctx();
  if (hits.length === 0) { c.printLine(t('serverNoResults'), 'info'); return; }
  c.printLine(`<cmd>${t('serverResults', { n: hits.length })}</cmd>`, 'accent');
  hits.forEach((h, i) => {
    const dur = h.duration ? ` (${formatTime(h.duration)})` : '';
    const tags = h.tags.length > 0 ? ` [${h.tags.map(escapeHtml).join(', ')}]` : '';
    const artist = h.artist && h.artist !== 'Unknown Artist' ? ` - ${escapeHtml(h.artist)}` : '';
    c.printRaw(`  ${i + 1}. ${escapeHtml(h.title)}${artist}${tags}${dur}`);
  });
  c.printRaw(t('serverResultsHint'));
}

function pickResult(arg: string): RemoteSearchHit | null {
  const c = ctx();
  if (lastResults.length === 0) { c.printLine(t('serverNoSearchYet'), 'info'); return null; }
  const n = parseInt(arg, 10);
  if (isNaN(n) || n < 1 || n > lastResults.length) {
    c.printLine(t('invalidIndex', { n: arg, max: lastResults.length }), 'error');
    return null;
  }
  return lastResults[n - 1];
}

export function registerServerCommands() {
  register('server', ['srv'], async (args) => {
    const c = ctx();
    const sub = (args[0] || '').toLowerCase();
    const rest = args.slice(1);

    if (!isTauri()) { c.printLine(t('serverTauriOnly'), 'error'); return; }

    // --- server add <name> <url> [token] ---
    if (sub === 'add') {
      const [name, url, token] = rest;
      if (!name || !url || !/^https?:\/\//i.test(url)) { c.printLine(t('serverAddUsage'), 'info'); return; }
      const servers = getServers();
      if (servers.some(s => s.name.toLowerCase() === name.toLowerCase())) {
        c.printLine(t('serverDuplicate', { name: escapeHtml(name) }), 'error');
        return;
      }
      const entry: RemoteServer = { name, url: url.replace(/\/+$/, '') };
      if (token) entry.token = token;
      await saveServers([...servers, entry]);
      c.printLine(t('serverAdded', { name: escapeHtml(name) }), 'success');
      return;
    }

    // --- server list ---
    if (sub === 'list' || sub === 'ls' || !sub) {
      const servers = getServers();
      if (servers.length === 0) { c.printLine(t('serverNone'), 'info'); return; }
      c.printLine(`<cmd>${t('serverListTitle')}</cmd>`, 'accent');
      servers.forEach((s, i) => {
        const mark = activeServer && activeServer.name === s.name ? ' <cmd>*</cmd>' : '';
        const lock = s.token ? ' 🔒' : '';
        c.printLine(`  ${i + 1}. ${escapeHtml(s.name)}  ${escapeHtml(s.url)}${lock}${mark}`);
      });
      return;
    }

    // --- server rm <name|n> ---
    if (sub === 'rm' || sub === 'remove' || sub === 'del' || sub === 'delete') {
      const target = rest.join(' ');
      const found = target ? findServer(target) : null;
      if (!found) { c.printLine(t('serverNotFound', { name: escapeHtml(target) }), 'error'); return; }
      await saveServers(getServers().filter(s => s.name !== found.name));
      if (activeServer && activeServer.name === found.name) activeServer = null;
      c.printLine(t('serverRemoved', { name: escapeHtml(found.name) }), 'success');
      return;
    }

    // --- server connect <name|n> ---
    if (sub === 'connect' || sub === 'c') {
      const target = rest.join(' ');
      const found = target ? findServer(target) : (getServers().length === 1 ? getServers()[0] : null);
      if (!found) { c.printLine(t('serverConnectUsage'), 'info'); return; }
      try {
        const status = await apiGet<{ playlist_len: number; playing: boolean }>(found, '/status');
        activeServer = found;
        c.printLine(t('serverConnected', { name: escapeHtml(found.name), n: status.playlist_len }), 'success');
        c.printRaw(t('serverConnectedHint'));
      } catch (err) {
        c.printLine(t('serverConnectFailed', { err: escapeHtml(String(err)) }), 'error');
      }
      return;
    }

    // --- server disconnect ---
    if (sub === 'disconnect' || sub === 'dc') {
      if (!activeServer) { c.printLine(t('serverNotConnected'), 'info'); return; }
      c.printLine(t('serverDisconnected', { name: escapeHtml(activeServer.name) }), 'success');
      activeServer = null;
      return;
    }

    // --- server status ---
    if (sub === 'status') {
      if (!activeServer) { c.printLine(t('serverNotConnected'), 'info'); return; }
      try {
        const s = await apiGet<{ playlist_len: number; playing: boolean; current_track: string | null }>(activeServer, '/status');
        c.printKV(t('serverStatusTitle') + ': ' + activeServer.name, [
          ['URL', activeServer.url],
          [t('serverTracks'), s.playlist_len],
          [t('serverPlaying'), s.playing ? (s.current_track ? getFileName(s.current_track) : 'yes') : 'no'],
        ]);
      } catch (err) {
        c.printLine(t('serverConnectFailed', { err: escapeHtml(String(err)) }), 'error');
      }
      return;
    }

    // --- server autoadd on|off (no connection needed) ---
    if (sub === 'autoadd' || sub === 'aa') {
      const arg = (rest[0] || '').toLowerCase();
      if (arg === 'on' || arg === 'true' || arg === '1') {
        c.saveSettings({ serverAutoAdd: true });
        c.printLine(t('serverAutoAddOn'), 'success');
      } else if (arg === 'off' || arg === 'false' || arg === '0') {
        c.saveSettings({ serverAutoAdd: false });
        c.printLine(t('serverAutoAddOff'), 'success');
      } else {
        c.printLine(t('serverAutoAddUsage', { v: getStoredSettings().serverAutoAdd ? 'on' : 'off' }), 'info');
      }
      return;
    }

    // Everything below needs an active connection.
    if (!activeServer) { c.printLine(t('serverNotConnected'), 'info'); return; }

    // --- server search <query...> [--tag <t>] ---
    if (sub === 'search' || sub === 's') {
      const words: string[] = [];
      let tag = '';
      for (let i = 0; i < rest.length; i++) {
        if (rest[i] === '--tag' && rest[i + 1]) { tag = rest[++i]; continue; }
        words.push(rest[i]);
      }
      const q = words.join(' ');
      if (!q && !tag) { c.printLine(t('serverSearchUsage'), 'info'); return; }
      try {
        const params = new URLSearchParams();
        if (q) params.set('q', q);
        if (tag) params.set('tag', tag);
        lastResults = await apiGet<RemoteSearchHit[]>(activeServer, `/search?${params.toString()}`);
        printSearchResults(lastResults);
      } catch (err) {
        c.printLine(t('serverConnectFailed', { err: escapeHtml(String(err)) }), 'error');
      }
      return;
    }

    // --- server play <n> [--add|--no-add] ---
    if (sub === 'play' || sub === 'p') {
      let autoAdd = getStoredSettings().serverAutoAdd;
      const positional: string[] = [];
      for (let i = 0; i < rest.length; i++) {
        const a = rest[i];
        if (a === '--add') { autoAdd = true; continue; }
        if (a === '--no-add' || a === '--noadd') { autoAdd = false; continue; }
        positional.push(a);
      }
      const hit = pickResult(positional[0] || '');
      if (!hit) return;
      try {
        const dest = await ensureDownloaded(activeServer, hit);
        if (autoAdd) c.addTracksToPlaylist(c.defaultPlaylistName(), [dest]);
        await c.playPath(dest);
        const meta = await readMetadata(dest);
        if (meta) { printNowPlaying(meta); await c.loadLRC(dest); }
        c.printLine(t('playing'), 'success');
      } catch (err) {
        c.printLine(escapeHtml(String(err)), 'error');
      }
      return;
    }

    // --- server get <n> (download only) ---
    if (sub === 'get' || sub === 'download' || sub === 'dl') {
      const hit = pickResult(rest[0] || '');
      if (!hit) return;
      try {
        const dest = await ensureDownloaded(activeServer, hit);
        c.printRaw(`  ${dest}`);
      } catch (err) {
        c.printLine(escapeHtml(String(err)), 'error');
      }
      return;
    }

    c.printLine(t('serverUsage'), 'info');
  }, 'helpServer');
}
