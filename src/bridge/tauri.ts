import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { IBridge } from './index';
import type { MetadataResult, LyricsUpdateData, LyricsThemeData } from '../types';

export const tauriBridge: IBridge = {
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

  async listAudioFiles(dirPath: string) {
    return await invoke<string[]>('list_audio_files', { dirPath });
  },

  async findLrc(mp3Path: string, rootDir: string) {
    return await invoke<string | null>('find_lrc', { mp3Path, rootDir });
  },

  async readLrcOffsets(lrcDir: string) {
    return await invoke<Record<string, number>>('read_lrc_offsets', { lrcDir });
  },

  async writeLrcOffset(lrcDir: string, trackName: string, offsetMs: number) {
    return await invoke<void>('write_lrc_offset', { lrcDir, trackName, offsetMs })
      .then(() => ({ success: true }))
      .catch(e => ({ error: String(e) }));
  },

  async readMetadata(filePath: string) {
    return await invoke<MetadataResult>('read_metadata', { path: filePath });
  },

  async readFile(filePath: string) {
    try {
      return await invoke<string>('read_file', { path: filePath });
    } catch (e) {
      return { error: String(e) };
    }
  },

  async readFileBase64(filePath: string) {
    try {
      return await invoke<string>('read_file_base64', { path: filePath });
    } catch (e) {
      return { error: String(e) };
    }
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

  async writeFile(filePath: string, content: string) {
    return await invoke<void>('write_file', { path: filePath, content })
      .then(() => ({ success: true }))
      .catch(e => ({ error: String(e) }));
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

  async dirExists(dirPath: string) {
    return await invoke<boolean>('dir_exists', { dirPath });
  },

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


  async readConfig(musicFolder: string, key: string) {
    return await invoke('read_config', { musicFolder, key });
  },

  async writeConfig(musicFolder: string, key: string, data: unknown) {
    return await invoke<void>('write_config', { musicFolder, key, data })
      .then(() => ({ success: true }))
      .catch(e => ({ error: String(e) }));
  },


  async selectSyncFile() {
    return await open({
      filters: [
        { name: 'MusicLI Sync Package', extensions: ['zip'] },
        { name: 'MusicLI Manifest', extensions: ['json'] },
      ],
    });
  },

  async copyFile(src: string, dest: string) {
    return await invoke<void>('copy_file', { src, dest })
      .then(() => ({ success: true }))
      .catch(e => ({ error: String(e) }));
  },

  async mkdir(dir: string) {
    return await invoke<void>('make_dir', { dir })
      .then(() => ({ success: true }))
      .catch(e => ({ error: String(e) }));
  },

  async createZip(sourceDir: string, destZip: string) {
    return await invoke<void>('create_zip', { sourceDir, destZip })
      .then(() => ({ success: true }))
      .catch(e => ({ error: String(e) }));
  },

  async extractZip(zipPath: string, destDir: string) {
    return await invoke<void>('extract_zip', { zipPath, destDir })
      .then(() => ({ success: true }))
      .catch(e => ({ error: String(e) }));
  },

  // --- Audio Engine ---

  async loadTrack(path: string) {
    return await invoke<number>('load_track', { path });
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

  async getPosition() {
    return await invoke<number>('get_position');
  },

  async getDuration() {
    return await invoke<number>('get_duration');
  },

  async setAudioMode(mode: 'normal' | 'asio') {
    return await invoke<string>('set_audio_mode', { mode });
  },

  async getAudioMode() {
    return await invoke<string>('get_audio_mode');
  },

  async listAudioDevices() {
    return await invoke<string[]>('list_audio_devices');
  },
};
