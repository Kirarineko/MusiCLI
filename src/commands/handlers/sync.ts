import { register } from '../registry';
import { ctx, sanitizeName } from './index';
import { t } from '../../i18n';
import { getBridge } from '../../bridge';
import { getStoredSettings } from '../../contexts/SettingsContext';
import { hasError } from '../../utils/guards';
import { escapeHtml } from '../../utils/format';

export function registerSyncCommands() {
  register('sync', ['share'], async (args) => {
    const c = ctx();
    const sub = (args[0] || '').toLowerCase();
    const rest = args.slice(1);

    if (sub === 'pl' || sub === 'playlist') {
      const action = (rest[0] || '').toLowerCase();
      if (action === 'export') {
        const plName = rest.slice(1).join(' ') || c.getCurrentPlName();
        const pl = c.getPlaylistData(plName);
        if (!pl) { c.printLine(t('plNotFound'), 'error'); return; }
        if (pl.tracks.length === 0) { c.printLine(t('playlistEmpty'), 'info'); return; }

        const s = getStoredSettings();
        const musicFolder = s.musicFolder || '';

        const savePath = await getBridge().saveFileDialog(
          `MusicLI_${sanitizeName(plName)}_sync.zip`,
          [{ name: 'ZIP Archive', extensions: ['zip'] }],
        );
        if (!savePath) return;

        const tmpDir = savePath.replace(/\.zip$/i, '') + '_tmp';
        const audioDir = tmpDir + '/audio';
        const lrcDir = tmpDir + '/lrc';
        await getBridge().mkdir(audioDir);
        await getBridge().mkdir(lrcDir);

        c.printLine(t('syncExporting', { n: pl.tracks.length }), 'info');

        const lrcOffsets: Record<string, number> = {};
        const trackMetas: import('../../types').SyncTrackMeta[] = [];

        for (let i = 0; i < pl.tracks.length; i++) {
          const src = pl.tracks[i];
          const meta = await getBridge().readMetadata(src);
          if (hasError(meta)) continue;

          const idx = String(i + 1).padStart(2, '0');
          const ext = src.split('.').pop() || 'mp3';
          const safeTitle = sanitizeName(meta.title || (src.split(/[/\\]/).pop() || src));
          const baseName = `${idx} - ${safeTitle}`;

          const audioDest = audioDir + '/' + baseName + '.' + ext;
          const copyResult = await getBridge().copyFile(src, audioDest);
          if (hasError(copyResult)) {
            c.printLine(t('syncCopyError', { file: baseName + '.' + ext, err: copyResult.error }), 'error');
          }

          let lrcFile: string | undefined;
          let lrcOffset: number | undefined;
          if (musicFolder) {
            const found = await getBridge().findLrc(src, musicFolder);
            if (found && !hasError(found)) {
              const lrcDest = lrcDir + '/' + baseName + '.lrc';
              await getBridge().copyFile(found, lrcDest);
              lrcFile = baseName + '.lrc';

              const lrcParentDir = found.substring(0, Math.max(found.lastIndexOf('/'), found.lastIndexOf('\\')));
              const offsets = await getBridge().readLrcOffsets(lrcParentDir);
              if (offsets && !hasError(offsets)) {
                const trackKey = src.split(/[/\\]/).pop() || src;
                if (offsets[trackKey]) {
                  lrcOffset = offsets[trackKey];
                  lrcOffsets[baseName + '.lrc'] = lrcOffset;
                }
              }
            }
          }

          trackMetas.push({
            filename: baseName + '.' + ext,
            title: meta.title || (src.split(/[/\\]/).pop() || src),
            artist: meta.artist || 'Unknown Artist',
            album: meta.album || '',
            year: meta.year || null,
            genre: meta.genre || null,
            duration: meta.duration || 0,
            lrcFile,
            ...(lrcOffset != null ? { lrcOffset } : {}),
          });
        }

        const manifest: import('../../types').SyncManifest = {
          version: 1,
          type: 'playlist',
          source: 'MusicLI',
          playlist: {
            name: pl.name,
            desc: pl.desc || '',
            createdAt: pl.createdAt,
            updatedAt: new Date().toISOString(),
            sharer: pl.sharer || '',
            tracks: trackMetas,
          },
          lrcOffsets: Object.keys(lrcOffsets).length > 0 ? lrcOffsets : undefined,
        };
        await getBridge().writeFile(tmpDir + '/manifest.json', JSON.stringify(manifest, null, 2));

        const readme = 'NekoCraft\nhttps://github.com/KirariNeko/MusicLI\n';
        await getBridge().writeFile(tmpDir + '/README.txt', readme);

        c.printLine(t('syncZipping'), 'info');
        const zipResult = await getBridge().createZip(tmpDir, savePath);
        if (hasError(zipResult)) {
          c.printLine(t('syncZipError', { err: zipResult.error }), 'error');
        } else {
          c.printLine(t('syncExported', { path: savePath, n: pl.tracks.length }), 'success');
        }
      } else if (action === 'import') {
        const filePath = await getBridge().selectSyncFile();
        if (!filePath) return;

        const s = getStoredSettings();
        const musicFolder = s.musicFolder || (await getBridge().getDefaultMusicDir());
        const isZip = filePath.toLowerCase().endsWith('.zip');

        let manifest: import('../../types').SyncManifest;
        let audioSrcDir: string;
        let lrcSrcDir: string;

        if (isZip) {
          const extractDir = filePath.replace(/\.zip$/i, '') + '_extracted';
          c.printLine(t('syncExtracting'), 'info');
          const extractResult = await getBridge().extractZip(filePath, extractDir);
          if (hasError(extractResult)) {
            c.printLine(t('syncZipError', { err: extractResult.error }), 'error');
            return;
          }
          const raw = await getBridge().readFile(extractDir + '/manifest.json');
          if (hasError(raw) || !raw) { c.printLine(t('syncInvalidManifest'), 'error'); return; }
          try { manifest = JSON.parse(raw); } catch { c.printLine(t('syncInvalidManifest'), 'error'); return; }
          audioSrcDir = extractDir + '/audio';
          lrcSrcDir = extractDir + '/lrc';
        } else {
          const raw = await getBridge().readFile(filePath);
          if (hasError(raw) || !raw) { c.printLine(t('syncInvalidManifest'), 'error'); return; }
          try { manifest = JSON.parse(raw); } catch { c.printLine(t('syncInvalidManifest'), 'error'); return; }
          const pkgDir = filePath.substring(0, Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\')));
          audioSrcDir = pkgDir + '/audio';
          lrcSrcDir = pkgDir + '/lrc';
        }

        if (!manifest.playlist || !manifest.playlist.tracks) {
          c.printLine(t('syncInvalidManifest'), 'error'); return;
        }

        const importDir = musicFolder.replace(/[/\\]$/, '') + '/MusicLI_Imports/' + sanitizeName(manifest.playlist.name);
        await getBridge().mkdir(importDir);

        c.printLine(t('syncImporting', { n: manifest.playlist.tracks.length }), 'info');

        const newTracks: string[] = [];
        for (const track of manifest.playlist.tracks) {
          const audioSrc = audioSrcDir + '/' + track.filename;
          const audioDest = importDir + '/' + track.filename;
          const copyResult = await getBridge().copyFile(audioSrc, audioDest);
          if (hasError(copyResult)) {
            c.printLine(t('syncCopyError', { file: track.filename, err: copyResult.error }), 'error');
            continue;
          }
          newTracks.push(audioDest);

          if (track.lrcFile) {
            const lrcSrc = lrcSrcDir + '/' + track.lrcFile;
            const lrcDest = importDir + '/' + track.lrcFile;
            await getBridge().copyFile(lrcSrc, lrcDest);
          }
        }

        if (manifest.lrcOffsets && Object.keys(manifest.lrcOffsets).length > 0) {
          for (const [lrcName, offset] of Object.entries(manifest.lrcOffsets)) {
            const trackName = lrcName.replace(/\.lrc$/i, '');
            await getBridge().writeLrcOffset(importDir, trackName, offset);
          }
        }

        let plName = manifest.playlist.name;
        if (c.getPlaylistData(plName)) {
          let n = 1;
          while (c.getPlaylistData(plName + '_' + n)) n++;
          plName = plName + '_' + n;
        }
        c.createPlaylistWithTracks(plName, manifest.playlist.desc, manifest.playlist.sharer, newTracks);
        c.printLine(t('syncImported', { name: plName, n: newTracks.length }), 'success');
      } else {
        c.printLine(t('syncUsage'), 'info');
      }
    } else if (sub === 'theme') {
      const action = (rest[0] || '').toLowerCase();
      const themeRest = rest.slice(1);

      if (action === 'save') {
        if (themeRest.length === 0) { c.printLine(t('themeUsage'), 'info'); return; }
        c.saveCurrentTheme(themeRest.join(' '));
        c.printLine(t('themeSaved', { name: themeRest.join(' ') }), 'success');
      } else if (action === 'load' || action === 'apply' || action === 'switch') {
        if (themeRest.length === 0) { c.printLine(t('themeUsage'), 'info'); return; }
        const name = themeRest.join(' ');
        if (c.applyTheme(name)) c.printLine(t('themeLoaded', { name }), 'success');
        else c.printLine(t('themeNotFound'), 'error');
      } else if (action === 'list' || action === 'ls') {
        const names = c.themeNames();
        c.printList(t('themeList') + ' (' + names.length + ')', names.map(n => {
          const th = c.getTheme(n);
          return { name: n, meta: th ? th.fg + '  ' + th.accent : '', highlight: false };
        }));
      } else if (action === 'delete' || action === 'rm' || action === 'del') {
        if (themeRest.length === 0) { c.printLine(t('themeUsage'), 'info'); return; }
        const name = themeRest.join(' ');
        const r = c.deleteTheme(name);
        if (r.error === 'notFound') c.printLine(t('themeNotFound'), 'error');
        else if (r.error === 'builtin') c.printLine(t('themeDeleteBuiltin'), 'error');
        else c.printLine(t('themeDeleted', { name }), 'success');
      } else if (action === 'export') {
        const name = themeRest.join(' ') || c.themeNames()[0] || '';
        const theme = c.exportTheme(name);
        if (!theme) { c.printLine(t('themeNotFound'), 'error'); return; }
        if (!theme['bg-img-data']) {
          const st = getStoredSettings();
          const imgPath = st['bg-img'];
          if (imgPath) {
            try {
              const b64 = await getBridge().readFileBase64(imgPath);
              if (!hasError(b64)) theme['bg-img-data'] = b64;
            } catch { /* ignore */ }
          }
        }
        const jsonStr = JSON.stringify(theme, null, 2);
        const savePath = await getBridge().saveFileDialog((name || 'theme') + '.json');
        if (!savePath) return;
        const wr = await getBridge().writeFile(savePath, jsonStr);
        if ((wr as { error?: string }).error) { c.printLine((wr as { error?: string }).error!, 'error'); return; }
        c.printLine(t('syncThemeExported'), 'success');
      } else if (action === 'import') {
        const filePath = await getBridge().openThemeDialog();
        if (!filePath) return;
        const result = await getBridge().readFile(filePath);
        if (hasError(result) || !result) { c.printLine(t('themeImportError'), 'error'); return; }
        // Use importTheme to actually apply the imported colors (not saveCurrentTheme
        // which would save the *current* settings under the imported name).
        const importResult = c.importTheme(result);
        if (importResult.success && importResult.name) {
          c.applyTheme(importResult.name);
          c.printLine(t('syncThemeImported', { name: importResult.name }), 'success');
        } else {
          c.printLine(t('themeImportError'), 'error');
        }
      } else if (/^\d+$/.test(action)) {
        const idx = parseInt(action, 10) - 1;
        const names = c.themeNames();
        if (idx >= 0 && idx < names.length) {
          if (c.applyTheme(names[idx])) c.printLine(t('themeLoaded', { name: names[idx] }), 'success');
        } else c.printLine(t('themeNotFound'), 'error');
      } else if (!action) {
        const names = c.themeNames();
        if (names.length === 0) { c.printLine(t('themeNotFound'), 'info'); return; }
        c.printLine(`<cmd>${t('themeList')} (${names.length})</cmd>`, 'accent');
        for (let i = 0; i < names.length; i++) {
          const th = c.getTheme(names[i]);
          // Escape theme name and color values to prevent XSS via SafeHtml.
          const safeName = escapeHtml(names[i]);
          const safeFg = escapeHtml(th?.fg ?? '#fff');
          const safeAccent = escapeHtml(th?.accent ?? '#888');
          const fgSpan = `<span style="color:${safeFg}">text</span>`;
          const accentSpan = `<span style="color:${safeAccent}">accent</span>`;
          c.printLine(`  ${i + 1}. ${safeName}  [${fgSpan}  ${accentSpan}]`);
        }
        c.printLine(t('themeSwitchHint'), 'dim');
      } else {
        c.printLine(t('themeUsage'), 'info');
      }
    } else {
      c.printLine(t('syncUsage'), 'info');
    }
  }, 'helpSync');
}
