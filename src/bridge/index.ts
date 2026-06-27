import type { MetadataResult, LyricsUpdateData, LyricsThemeData } from '../types';

export interface IBridge {
  selectFiles(): Promise<string[]>;
  selectImage(): Promise<string | null>;
  selectFolder(): Promise<string | null>;
  selectFont(): Promise<string | null>;
  listAudioFiles(dirPath: string): Promise<string[] | { error: string }>;
  findLrc(mp3Path: string, rootDir: string): Promise<string | null | { error: string }>;
  readLrcOffsets(lrcDir: string): Promise<Record<string, number> | { error: string }>;
  writeLrcOffset(lrcDir: string, trackName: string, offsetMs: number): Promise<{ success?: boolean; error?: string }>;
  readMetadata(filePath: string): Promise<MetadataResult>;
  readFile(filePath: string): Promise<string | { error: string }>;
  readFileBase64(filePath: string): Promise<string | { error: string }>;
  saveFileDialog(name: string, filters?: { name: string; extensions: string[] }[]): Promise<string | null>;
  openThemeDialog(): Promise<string | null>;
  writeFile(filePath: string, content: string): Promise<{ success?: boolean; error?: string }>;
  minimize(): void;
  close(): void;
  getDefaultMusicDir(): Promise<string>;
  dirExists(dirPath: string): Promise<boolean>;
  showFloatingLyrics(): Promise<void>;
  hideFloatingLyrics(): Promise<void>;
  setLyricsMouseEvents(enabled: boolean): void;
  autoSizeLyrics(w: number, h: number): void;
  sendLyricsUpdate(data: LyricsUpdateData): void;
  sendLyricsTheme(data: LyricsThemeData): void;
  onLyricsUpdate(callback: (data: LyricsUpdateData) => void): () => void;
  onLyricsTheme(callback: (data: LyricsThemeData) => void): () => void;

  readConfig(musicFolder: string, key: string): Promise<any | null | { error: string }>;
  writeConfig(musicFolder: string, key: string, data: any): Promise<{ success?: boolean; error?: string }>;

  selectSyncFile(): Promise<string | null>;
  copyFile(src: string, dest: string): Promise<{ success?: boolean; error?: string }>;
  mkdir(dir: string): Promise<{ success?: boolean; error?: string }>;
  createZip(sourceDir: string, destZip: string): Promise<{ success?: boolean; error?: string }>;
  extractZip(zipPath: string, destDir: string): Promise<{ success?: boolean; error?: string }>;

  // Audio Engine
  loadTrack(path: string): Promise<number>;
  audioPlay(path: string): Promise<void>;
  audioPause(): Promise<void>;
  audioStop(): Promise<void>;
  audioSeek(seconds: number): Promise<void>;
  setVolume(vol: number): Promise<void>;
  getPosition(): Promise<number>;
  getDuration(): Promise<number>;
  setAudioMode(mode: 'normal' | 'asio'): Promise<string>;
  getAudioMode(): Promise<string>;
  listAudioDevices(): Promise<string[]>;
}

let _bridge: IBridge | null = null;

export function setBridge(bridge: IBridge): void {
  _bridge = bridge;
}

export function getBridge(): IBridge {
  if (!_bridge) throw new Error('Bridge not initialized. Call setBridge() first.');
  return _bridge;
}

export function isBridgeAvailable(): boolean {
  return _bridge !== null;
}

export async function initBridge(): Promise<void> {
  if (_bridge) return;
  // Detect Tauri environment
  if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
    const { tauriBridge } = await import('./tauri');
    setBridge(tauriBridge);
    return;
  }
  // Fallback: no bridge available (browser mode)
  console.warn('[bridge] No native bridge available. Running in browser mode.');
}
