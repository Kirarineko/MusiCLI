import type { MetadataResult } from '../types';

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

async function unwrap<T>(promise: Promise<T | { error: string }>): Promise<T> {
  const res = await promise;
  if (typeof res === 'object' && res !== null && 'error' in res) throw new Error(res.error);
  return res as T;
}

type SyncResult = { success?: boolean; error?: string };

export function createHttpBridge() {
  return {
    // Audio Engine
    loadTrack: (path: string) => unwrap(apiPost<number>('/load', { path })),
    audioPlay: (path: string) => unwrap(apiPost<void>('/play', { path })),
    audioPause: () => unwrap(apiPost<void>('/pause')),
    audioStop: () => unwrap(apiPost<void>('/stop')),
    audioSeek: (seconds: number) => unwrap(apiPost<void>('/seek', { seconds })),
    setVolume: (vol: number) => unwrap(apiPost<void>('/volume', { volume: vol })),
    getPosition: () => unwrap(apiGet<number>('/status/position')),
    getDuration: () => unwrap(apiGet<number>('/status/duration')),
    setAudioMode: (mode: 'normal' | 'asio') => unwrap(apiPost<string>('/mode', { mode })),
    getAudioMode: () => unwrap(apiGet<string>('/mode')),
    listAudioDevices: () => unwrap(apiGet<string[]>('/devices')),

    // Metadata
    readMetadata: (filePath: string) => unwrap(apiGet<MetadataResult>(`/metadata?path=${encodeURIComponent(filePath)}`)),

    // Files
    listAudioFiles: (dirPath: string) => apiGet<string[]>(`/files/list?dir=${encodeURIComponent(dirPath)}`),
    readFileBase64: (filePath: string) => apiGet<string>(`/files/read?path=${encodeURIComponent(filePath)}`),
    readFile: (filePath: string) => apiGet<string>(`/files/read?path=${encodeURIComponent(filePath)}`),
    writeFile: (filePath: string, content: string) => apiPost<SyncResult>('/files/write', { path: filePath, content }),
    copyFile: (src: string, dest: string) => apiPost<SyncResult>('/files/copy', { src, dest }),
    mkdir: (dir: string) => apiPost<SyncResult>('/files/mkdir', { path: dir }),
    dirExists: (dirPath: string) => unwrap(apiGet<boolean>(`/files/exists?path=${encodeURIComponent(dirPath)}`)),

    // Config
    readConfig: (_musicFolder: string, key: string) => apiGet(`/config?key=${encodeURIComponent(key)}`),
    writeConfig: (_musicFolder: string, key: string, data: unknown) => apiPost<SyncResult>('/config', { key, data }),

    // Lyrics
    findLrc: (mp3Path: string, rootDir: string) => apiGet<string | null>(`/lyrics?path=${encodeURIComponent(mp3Path)}&root=${encodeURIComponent(rootDir)}`),
    readLrcOffsets: (lrcDir: string) => apiGet<Record<string, number>>(`/lyrics/offsets?dir=${encodeURIComponent(lrcDir)}`),
    writeLrcOffset: (lrcDir: string, trackName: string, offsetMs: number) => apiPost<SyncResult>('/lyrics/offsets', { dir: lrcDir, track: trackName, offset: offsetMs }),

    // Sync
    createZip: (sourceDir: string, destZip: string) => apiPost<SyncResult>('/sync/export', { srcDir: sourceDir, destPath: destZip }),
    extractZip: (zipPath: string, destDir: string) => apiPost<SyncResult>('/sync/import', { zipPath, destDir }),
  };
}
