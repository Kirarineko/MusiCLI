const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

let mainWindow;
let lyricsWindow = null;
let lastLyricsTheme = null;

const isDev = process.env.VITE_DEV_SERVER_URL != null;
const lyricsThemeFile = path.join(app.getPath('userData'), 'lyrics-theme.json');

// Load persisted theme on startup
try { lastLyricsTheme = JSON.parse(fs.readFileSync(lyricsThemeFile, 'utf-8')); } catch {}

function saveLyricsTheme(data) {
  lastLyricsTheme = data;
  try { fs.writeFileSync(lyricsThemeFile, JSON.stringify(data)); } catch {}
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 950,
    height: 650,
    minWidth: 700,
    minHeight: 400,
    frame: false,
    backgroundColor: '#0c0c0c',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Dev mode: page served from http://localhost, audio files use file://
      // which is cross-origin. Production: both are file://, no issue.
      webSecurity: !isDev,
    },
  });

  if (isDev) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.error('[main] Page load failed:', errorCode, errorDescription);
  });

  mainWindow.on('closed', () => {
    if (lyricsWindow && !lyricsWindow.isDestroyed()) {
      lyricsWindow.close();
      lyricsWindow = null;
    }
  });
}

// --- IPC Handlers ---

ipcMain.handle('dialog:openFiles', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Audio Files',
    filters: [{ name: 'Audio Files', extensions: ['mp3', 'flac', 'wav', 'ogg', 'm4a'] }],
    properties: ['openFile', 'multiSelections'],
  });
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle('file:readMetadata', async (_event, filePath) => {
  try {
    const mm = await import('music-metadata');
    const meta = await mm.parseFile(filePath, { duration: true });
    const tags = meta.common;
    const format = meta.format;
    return {
      title: tags.title || path.basename(filePath, path.extname(filePath)),
      artist: tags.artist || 'Unknown Artist',
      album: tags.album || 'Unknown Album',
      year: tags.year || null,
      genre: tags.genre ? (Array.isArray(tags.genre) ? tags.genre.join(', ') : tags.genre) : null,
      track: tags.track?.no || null,
      duration: format.duration || 0,
      bitrate: format.bitrate ? Math.round(format.bitrate / 1000) : null,
      sampleRate: format.sampleRate || null,
      codec: format.codec || 'Unknown',
    };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('dialog:openImage', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Background Image',
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] }],
    properties: ['openFile'],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('dialog:openFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Music Folder',
    properties: ['openDirectory'],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('dir:listAudio', async (_event, dirPath) => {
  try {
    const exts = ['.mp3', '.flac', '.wav', '.ogg', '.m4a', '.wma'];
    const files = fs.readdirSync(dirPath)
      .filter(f => exts.includes(path.extname(f).toLowerCase()))
      .sort()
      .map(f => path.join(dirPath, f));
    return files;
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('app:defaultMusicDir', () => {
  return path.join(os.homedir(), 'Music');
});

ipcMain.handle('fs:dirExists', async (_event, dirPath) => {
  try {
    return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
  } catch { return false; }
});

// Recursively search for .lrc file matching mp3 filename
ipcMain.handle('dir:findLrc', async (_event, mp3Path, rootDir) => {
  try {
    const ext = path.extname(mp3Path);
    const baseName = path.basename(mp3Path, ext);
    // Match by case-insensitive filename (e.g. "song.lrc", "Song.LRC", "SONG.lrc")
    const target = baseName.toLowerCase() + '.lrc';

    function searchDir(dir) {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
            const found = searchDir(full);
            if (found) return found;
          } else if (entry.isFile() && entry.name.toLowerCase() === target) {
            return full;
          }
        }
      } catch { /* skip permission errors */ }
      return null;
    }
    const found = searchDir(rootDir);
    console.log('[lrc] findLrc:', mp3Path, '→', found || 'not found');
    return found;
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.on('window:minimize', () => mainWindow.minimize());

ipcMain.handle('file:read', async (_event, filePath) => {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('dialog:openFont', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Font File',
    filters: [{ name: 'Font Files', extensions: ['ttf', 'otf', 'woff', 'woff2'] }],
    properties: ['openFile'],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('file:readBase64', async (_event, filePath) => {
  try {
    const buf = fs.readFileSync(filePath);
    return buf.toString('base64');
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('dialog:saveFile', async (_event, defaultName, filters) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Theme',
    defaultPath: defaultName,
    filters: filters || [{ name: 'Theme Files', extensions: ['json'] }],
  });
  return result.canceled ? null : result.filePath;
});

ipcMain.handle('dialog:openTheme', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import Theme',
    filters: [{ name: 'Theme Files', extensions: ['json'] }],
    properties: ['openFile'],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('file:write', async (_event, filePath, content) => {
  try {
    fs.writeFileSync(filePath, content, 'utf-8');
    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('app:userDataPath', () => {
  return app.getPath('userData');
});

// --- Floating Lyrics Window ---

function createLyricsWindow() {
  if (lyricsWindow && !lyricsWindow.isDestroyed()) {
    lyricsWindow.show();
    return;
  }
  lyricsWindow = new BrowserWindow({
    width: 600,
    height: 180,
    minWidth: 300,
    minHeight: 100,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // Register listener BEFORE loading — ensures we catch the event
  lyricsWindow.webContents.on('did-finish-load', () => {
    if (lastLyricsTheme) {
      lyricsWindow.webContents.send('lyrics:update-theme', lastLyricsTheme);
    }
  });
  if (isDev) {
    lyricsWindow.loadURL(process.env.VITE_DEV_SERVER_URL + '#/lyrics');
  } else {
    lyricsWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { hash: '/lyrics' });
  }
  lyricsWindow.setAlwaysOnTop(true, 'floating');
  lyricsWindow.on('closed', () => { lyricsWindow = null; });
}

ipcMain.handle('lyrics-window:show', () => {
  createLyricsWindow();
});

ipcMain.handle('lyrics-window:hide', () => {
  if (lyricsWindow && !lyricsWindow.isDestroyed()) {
    lyricsWindow.close();
  }
  lyricsWindow = null;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('lyrics:visibility-changed', { visible: false });
  }
});

ipcMain.on('lyrics-window:send', (_event, data) => {
  if (lyricsWindow && !lyricsWindow.isDestroyed()) {
    lyricsWindow.webContents.send('lyrics:update', data);
  }
});

ipcMain.on('lyrics-window:update-theme', (_event, data) => {
  saveLyricsTheme(data);
  if (lyricsWindow && !lyricsWindow.isDestroyed()) {
    lyricsWindow.webContents.send('lyrics:update-theme', data);
  }
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (lyricsWindow && !lyricsWindow.isDestroyed()) {
    lyricsWindow.close();
    lyricsWindow = null;
  }
  app.quit();
});
