import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { LyricsUpdateData, LyricsThemeData } from '../types';

export const tauriBridge = {
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
