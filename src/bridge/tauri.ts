import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { LyricsUpdateData, LyricsThemeData, MetadataResult } from '../types';

export const tauriBridge = {
  // --- Audio playback (Tauri invoke) ---
  async loadTrack(path: string): Promise<number> {
    return await invoke('load_track', { path });
  },
  async audioPlay(path: string) {
    await invoke('play', { path });
  },
  async audioPause() {
    await invoke('pause');
  },
  async audioStop() {
    await invoke('stop');
  },
  async audioSeek(seconds: number) {
    await invoke('seek', { seconds });
  },
  async setVolume(vol: number) {
    await invoke('set_volume', { vol });
  },
  async getPosition(): Promise<number> {
    return await invoke('get_position');
  },
  async getDuration(): Promise<number> {
    return await invoke('get_duration');
  },
  async isPlaying(): Promise<boolean> {
    return await invoke('is_playing');
  },
  async getVolume(): Promise<number> {
    return await invoke('get_volume');
  },

  // --- Metadata ---
  async readMetadata(path: string): Promise<MetadataResult> {
    const result = await invoke<MetadataResult | { error: string }>('read_metadata', { path });
    if (typeof result === 'object' && result !== null && 'error' in result) {
      throw new Error((result as { error: string }).error);
    }
    return result as MetadataResult;
  },

  // --- File operations ---
  async listAudioFiles(dir: string): Promise<string[] | { error: string }> {
    try {
      return await invoke<string[]>('list_audio_files', { dir });
    } catch (e) {
      return { error: String(e) };
    }
  },
  async readFileBase64(path: string): Promise<string | { error: string }> {
    try {
      return await invoke<string>('read_file_base64', { path });
    } catch (e) {
      return { error: String(e) };
    }
  },
  async dirExists(path: string): Promise<boolean> {
    try {
      return await invoke<boolean>('dir_exists', { path });
    } catch {
      return false;
    }
  },
  async readFile(path: string): Promise<string | { error: string }> {
    try {
      return await invoke<string>('read_file', { path });
    } catch (e) {
      return { error: String(e) };
    }
  },
  async writeFile(path: string, content: string): Promise<{ success?: boolean; error?: string }> {
    try {
      await invoke('write_file', { path, content });
      return { success: true };
    } catch (e) {
      return { error: String(e) };
    }
  },
  async copyFile(src: string, dest: string): Promise<{ success?: boolean; error?: string }> {
    try {
      await invoke('copy_file', { src, dest });
      return { success: true };
    } catch (e) {
      return { error: String(e) };
    }
  },
  async mkdir(path: string): Promise<{ success?: boolean; error?: string }> {
    try {
      await invoke('mkdir', { path });
      return { success: true };
    } catch (e) {
      return { error: String(e) };
    }
  },

  // --- Config ---
  async readConfig(musicFolder: string, key: string): Promise<unknown | null | { error: string }> {
    try {
      const path = `${musicFolder.replace(/\/$/, '')}/config/${key}.json`;
      const raw = await invoke<string>('read_file', { path });
      return JSON.parse(raw);
    } catch {
      return null;
    }
  },
  async writeConfig(musicFolder: string, key: string, data: unknown): Promise<{ success?: boolean; error?: string }> {
    try {
      const path = `${musicFolder.replace(/\/$/, '')}/config/${key}.json`;
      const content = typeof data === 'string' ? JSON.stringify(data) : JSON.stringify(data);
      await invoke('write_file', { path, content });
      return { success: true };
    } catch (e) {
      return { error: String(e) };
    }
  },

  // --- Lyrics ---
  async findLrc(audioPath: string, rootDir: string): Promise<string | null | { error: string }> {
    try {
      const result = await invoke<string | null>('find_lrc', { audioPath, rootDir });
      return result;
    } catch (e) {
      return { error: String(e) };
    }
  },
  async readLrcOffsets(lrcDir: string): Promise<Record<string, number> | { error: string }> {
    try {
      return await invoke<Record<string, number>>('read_lrc_offsets', { lrcDir });
    } catch (e) {
      return { error: String(e) };
    }
  },
  async writeLrcOffset(lrcDir: string, trackName: string, offset: number): Promise<{ success?: boolean; error?: string }> {
    try {
      await invoke('write_lrc_offset', { lrcDir, trackName, offset });
      return { success: true };
    } catch (e) {
      return { error: String(e) };
    }
  },

  // --- Audio mode ---
  async setAudioMode(mode: string) {
    return await invoke('set_audio_mode', { mode });
  },
  async getAudioMode() {
    return await invoke('get_audio_mode');
  },
  async listAudioDevices(): Promise<string[]> {
    return await invoke('list_audio_devices');
  },

  // --- ZIP ---
  async createZip(srcDir: string, destPath: string): Promise<{ success?: boolean; error?: string }> {
    try {
      await invoke('create_zip', { srcDir, destPath });
      return { success: true };
    } catch (e) {
      return { error: String(e) };
    }
  },
  async extractZip(zipPath: string, destDir: string): Promise<{ success?: boolean; error?: string }> {
    try {
      await invoke('extract_zip', { zipPath, destDir });
      return { success: true };
    } catch (e) {
      return { error: String(e) };
    }
  },

  // --- File dialogs ---
  async selectFiles() {
    const result = await open({
      multiple: true,
      filters: [{ name: 'Audio Files', extensions: ['mp3', 'flac', 'wav', 'ogg', 'm4a'] }],
    });
    return result ? (Array.isArray(result) ? result : [result]) : [];
  },

  async selectImage() {
    return await open({
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] }],
    });
  },

  async selectFolder() {
    return await open({ directory: true });
  },

  async selectFont() {
    return await open({
      filters: [{ name: 'Font Files', extensions: ['ttf', 'otf', 'woff', 'woff2'] }],
    });
  },

  async saveFileDialog(name: string, filters?: { name: string; extensions: string[] }[]) {
    return await save({
      defaultPath: name,
      filters: filters || [{ name: 'Theme Files', extensions: ['json'] }],
    });
  },

  async openThemeDialog() {
    return await open({
      filters: [{ name: 'Theme Files', extensions: ['json'] }],
    });
  },

  async selectSyncFile() {
    return await open({
      filters: [
        { name: 'MusicLI Sync Package', extensions: ['zip'] },
        { name: 'MusicLI Manifest', extensions: ['json'] },
      ],
    });
  },

  // --- Window ---
  setMusicFolder(path: string) {
    invoke('set_music_folder', { path }).catch(() => {});
  },

  minimize() {
    invoke('minimize_window');
  },

  close() {
    import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
      getCurrentWindow().close();
    });
  },

  async getDefaultMusicDir() {
    return await invoke<string>('default_music_dir');
  },

  // --- Floating lyrics window ---
  async showFloatingLyrics() {
    await invoke('show_lyrics_window');
  },

  async hideFloatingLyrics() {
    await invoke('hide_lyrics_window');
  },

  setLyricsMouseEvents(enabled: boolean) {
    invoke('lyrics_set_mouse_events', { enabled });
  },

  autoSizeLyrics(w: number, h: number) {
    invoke('lyrics_auto_size', { w, h });
  },

  sendLyricsUpdate(data: LyricsUpdateData) {
    invoke('send_lyrics_update', { data });
  },

  sendLyricsTheme(data: LyricsThemeData) {
    invoke('send_lyrics_theme', { data });
  },

  onLyricsUpdate(callback: (data: LyricsUpdateData) => void): () => void {
    let unlisten: UnlistenFn | null = null;
    listen<LyricsUpdateData>('lyrics:update', (event) => {
      callback(event.payload);
    }).then(fn => { unlisten = fn; });
    return () => { unlisten?.(); };
  },

  onLyricsTheme(callback: (data: LyricsThemeData) => void): () => void {
    let unlisten: UnlistenFn | null = null;
    listen<LyricsThemeData>('lyrics:update-theme', (event) => {
      callback(event.payload);
    }).then(fn => { unlisten = fn; });
    return () => { unlisten?.(); };
  },
};
