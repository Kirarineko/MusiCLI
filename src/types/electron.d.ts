export interface MetadataResult {
  title: string;
  artist: string;
  album: string;
  year: number | null;
  genre: string | null;
  track: number | null;
  duration: number;
  bitrate: number | null;
  sampleRate: number | null;
  codec: string;
  error?: string;
}

export interface LyricsUpdateData {
  current: string;
  next: string[];
}

export interface LyricsThemeData {
  font?: string;
  fontSize?: number;
  fg?: string;
  fgDim?: string;
  accent?: string;
  bg?: string;
  lyricsAccent?: string;
  lyricsFg?: string;
  lyricsNextCount?: number;
  lyricsGap?: number;
  lyricsShadow?: string;
  lyricsAlign?: string;
  lyricsCurrentSize?: number;
  lyricsNextSize?: number;
  lyricsVertical?: string;
}

export interface MusicPlayerAPI {
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
  getDefaultMusicDir(): Promise<string>;
  dirExists(dirPath: string): Promise<boolean>;
  showFloatingLyrics(): Promise<void>;
  setLyricsMouseEvents(enabled: boolean): void;
  autoSizeLyrics(w: number, h: number): void;
  hideFloatingLyrics(): Promise<void>;
  sendLyricsUpdate(data: LyricsUpdateData): void;
  sendLyricsTheme(data: LyricsThemeData): void;
  onLyricsUpdate(callback: (data: LyricsUpdateData) => void): void;
  onLyricsTheme(callback: (data: LyricsThemeData) => void): void;
  onLyricsVisibilityChanged(callback: (data: { visible: boolean }) => void): void;
  readConfig(musicFolder: string, key: string): Promise<any | null | { error: string }>;
  writeConfig(musicFolder: string, key: string, data: any): Promise<{ success?: boolean; error?: string }>;
  selectSaveDir(): Promise<string | null>;
  selectSyncFile(): Promise<string | null>;
  copyFile(src: string, dest: string): Promise<{ success?: boolean; error?: string }>;
  mkdir(dir: string): Promise<{ success?: boolean; error?: string }>;
  createZip(sourceDir: string, destZip: string): Promise<{ success?: boolean; error?: string }>;
  extractZip(zipPath: string, destDir: string): Promise<{ success?: boolean; error?: string }>;
}

declare global {
  interface Window {
    musicPlayer: MusicPlayerAPI;
    __isLyricsWindow?: boolean;
  }
}

export {};
