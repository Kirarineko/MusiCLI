const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('musicPlayer', {
  selectFiles: () => ipcRenderer.invoke('dialog:openFiles'),
  selectImage: () => ipcRenderer.invoke('dialog:openImage'),
  selectFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  selectFont: () => ipcRenderer.invoke('dialog:openFont'),
  listAudioFiles: (dirPath) => ipcRenderer.invoke('dir:listAudio', dirPath),
  readMetadata: (filePath) => ipcRenderer.invoke('file:readMetadata', filePath),
  readFile: (filePath) => ipcRenderer.invoke('file:read', filePath),
  readFileBase64: (filePath) => ipcRenderer.invoke('file:readBase64', filePath),
  saveFileDialog: (name, filters) => ipcRenderer.invoke('dialog:saveFile', name, filters),
  openThemeDialog: () => ipcRenderer.invoke('dialog:openTheme'),
  writeFile: (filePath, content) => ipcRenderer.invoke('file:write', filePath, content),
  minimize: () => ipcRenderer.send('window:minimize'),
  getDefaultMusicDir: () => ipcRenderer.invoke('app:defaultMusicDir'),
  dirExists: (dirPath) => ipcRenderer.invoke('fs:dirExists', dirPath),
  // Floating lyrics
  showFloatingLyrics: () => ipcRenderer.invoke('lyrics-window:show'),
  hideFloatingLyrics: () => ipcRenderer.invoke('lyrics-window:hide'),
  sendLyricsUpdate: (data) => ipcRenderer.send('lyrics-window:send', data),
  sendLyricsTheme: (data) => ipcRenderer.send('lyrics-window:update-theme', data),
  onLyricsUpdate: (callback) => ipcRenderer.on('lyrics:update', (_event, data) => callback(data)),
  onLyricsTheme: (callback) => ipcRenderer.on('lyrics:update-theme', (_event, data) => callback(data)),
  onLyricsVisibilityChanged: (callback) => ipcRenderer.on('lyrics:visibility-changed', (_event, data) => callback(data)),
});
