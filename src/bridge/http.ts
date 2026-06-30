import type { MetadataResult } from '../types';
import type { PlaybackStatus } from './index';

let _baseUrl = '';

export function setServerPort(port: number) {
  _baseUrl = `http://127.0.0.1:${port}`;
}

async function apiGet<T>(path: string): Promise<T | { error: string }> {
  try {
    const res = await fetch(`${_baseUrl}${path}`);
    if (!res.ok) return { error: `HTTP ${res.status}` };
    return res.json();
  } catch (e) {
    return { error: String(e) };
  }
}

async function apiPost<T>(path: string, body?: unknown): Promise<T | { error: string }> {
  try {
    const res = await fetch(`${_baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    return res.json();
  } catch (e) {
    return { error: String(e) };
  }
}

async function apiPut(path: string, body?: unknown): Promise<{ error?: string }> {
  try {
    const res = await fetch(`${_baseUrl}${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    return {};
  } catch (e) {
    return { error: String(e) };
  }
}

async function unwrap<T>(promise: Promise<T | { error: string }>): Promise<T> {
  const res = await promise;
  if (typeof res === 'object' && res !== null && 'error' in res) throw new Error(res.error);
  return res as T;
}

type SyncResult = { success?: boolean; error?: string };

export function createHttpBridge() {
  return {
    // Audio Engine
    audioPlay: (path: string) => unwrap(apiPost<void>('/play', { path })),
    audioPause: () => unwrap(apiPost<void>('/pause')),
    audioStop: () => unwrap(apiPost<void>('/stop')),
    audioSeek: (seconds: number) => unwrap(apiPost<void>('/seek', { seconds })),
    setVolume: (vol: number) => unwrap(apiPost<void>('/volume', { level: vol })),
    getPosition: () => unwrap(apiGet<number>('/status/position')),
    getDuration: () => unwrap(apiGet<number>('/status/duration')),
    setAudioMode: (mode: 'normal' | 'asio') => unwrap(apiPost<string>('/mode', { mode })),
    getAudioMode: () => unwrap(apiGet<string>('/audio-mode')),
    listAudioDevices: () => unwrap(apiGet<string[]>('/devices')),
    getPlaybackStatus: () => apiGet<PlaybackStatus>('/status'),

    // Metadata
    readMetadata: (filePath: string) => unwrap(apiGet<MetadataResult>(`/metadata?path=${encodeURIComponent(filePath)}`)),

    // Files
    listAudioFiles: (dirPath: string) => apiGet<string[]>(`/files/list?dir=${encodeURIComponent(dirPath)}`),
    listListenWebuis: (musicFolder: string) => apiGet<string[]>(`/files/list-html?dir=${encodeURIComponent(musicFolder + '/Listen_WebUI')}`),
    readFileBase64: (filePath: string) => apiGet<string>(`/files/read?path=${encodeURIComponent(filePath)}`),
    readFile: (filePath: string) => apiGet<string>(`/files/read?path=${encodeURIComponent(filePath)}`),

    // Config
    readConfig: (_musicFolder: string, key: string) => apiGet(`/config?key=${encodeURIComponent(key)}`),
    writeConfig: (_musicFolder: string, key: string, data: unknown) => apiPut(`/config?key=${encodeURIComponent(key)}`, data),

    // Lyrics — lrc_dir is derived server-side from music_folder/lrc,
    // so the lrcDir parameter is ignored in HTTP mode.
    findLrc: (mp3Path: string) => apiGet<string | null>(`/lyrics?audio_path=${encodeURIComponent(mp3Path)}`),
    readLrcOffsets: (_lrcDir: string) => apiGet<Record<string, number>>(`/lyrics/offsets`),
    writeLrcOffset: (_lrcDir: string, trackName: string, offsetMs: number) => apiPost<SyncResult>('/lyrics/offsets', { track_name: trackName, offset_ms: offsetMs }),

    // Sync
    createZip: (_sourceDir: string, destZip: string) => apiPost<SyncResult>('/sync/export', { dest_zip: destZip, playlist_names: [] }),
    extractZip: (zipPath: string) => apiPost<SyncResult>('/sync/import', { zip_path: zipPath }),
  };
}
