import { register } from '../registry';
import { ctx, readMetadata, printNowPlaying, showMetadata } from './index';
import { t } from '../../i18n';
import { getBridge } from '../../bridge';
import { getStoredSettings } from '../../contexts/SettingsContext';
import { escapeHtml, getFileName } from '../../utils/format';
import { fuzzySearch } from '../../utils/fuzzy';
import { hasError } from '../../utils/guards';
import type { InteractiveItem } from '../../types';

export function registerPlaylistCommands() {
  register('open', ['load'], async (args) => {
    const c = ctx();
    if (args[0] === 'dir' || args[0] === 'folder') {
      const dirPath = await getBridge().selectFolder();
      if (!dirPath) { c.printLine(t('folderNoSelect'), 'info'); return; }
      const files = await getBridge().listAudioFiles(dirPath);
      if (hasError(files)) { c.printLine(t('metadataError', { err: files.error }), 'error'); return; }
      if (!files || files.length === 0) { c.printLine(t('folderEmpty'), 'info'); return; }
      c.replaceCurrentTracks(files);
      const dirName = dirPath.split(/[/\\]/).pop() || dirPath;
      c.printLine(`<cmd>${escapeHtml(dirName)} (${files.length} ${t('tracks')})</cmd>`, 'accent');
      for (let i = 0; i < files.length; i++) {
        c.printRaw(`  ${i + 1}. ${getFileName(files[i])}`);
      }
      c.saveSettings({ musicFolder: dirPath });
      c.printLine(t('folderLoaded', { n: files.length }) + '  ' + t('typePlay'), 'info');
      return;
    }
    const files = await getBridge().selectFiles();
    if (files.length === 0) { c.printLine(t('noFiles'), 'info'); return; }
    c.addTracksToCurrent(files);
    const fp = c.playIndex(c.playlist.indexOf(files[0]));
    if (fp) {
      const meta = await readMetadata(fp);
      if (meta) { printNowPlaying(meta); await c.loadLRC(fp); }
    }
    c.printLine(t('addedFiles', { n: files.length }), 'info');
  }, 'helpOpen');

  register('cd', [], async (args) => {
    const c = ctx();
    if (args.length === 0) {
      const info = c.getCurrentPlaylist();
      if (info) {
        c.printLine(t('cdCurrent', { name: info.name }), 'info');
        c.printRaw('  ' + info.desc);
        c.printRaw('  ' + info.tracks.length + ' ' + t('tracks'));
      }
      return;
    }
    const name = args.join(' ');
    const result = c.switchPlaylist(name);
    if (!result) {
      c.printLine(t('cdNoMatch', { name }), 'error');
    } else if ((result as { candidates: string[] }).candidates) {
      c.printLine(t('cdCandidates', { name }), 'info');
      for (const n of (result as { candidates: string[] }).candidates) c.printRaw('  - ' + n);
    } else {
      const pl = result as { name: string; tracks: string[] };
      c.printLine(t('cdSwitched', { name: pl.name, n: pl.tracks.length }), 'success');
    }
  }, 'helpCd');

  register('import', ['batch'], async () => {
    const c = ctx();
    let folder = getStoredSettings().musicFolder || '';
    if (!folder) folder = await getBridge().getDefaultMusicDir();
    const exists = folder ? await getBridge().dirExists(folder) : false;
    if (!exists || !folder) { c.printLine(t('importNoFolder'), 'info'); return; }
    const files = await getBridge().listAudioFiles(folder);
    if (hasError(files) || !files || files.length === 0) { c.printLine(t('importNoFiles'), 'info'); return; }
    const items: InteractiveItem[] = files.map(f => ({
      name: getFileName(f), path: f, selected: false, visible: true,
    }));
    c.enterImode('import', items, (selected) => {
      if (selected.length > 0) {
        const tracks = selected.map(s => s.path!);
        c.addTracksToCurrent(tracks);
        c.printLine(t('importDone', { n: tracks.length, pl: c.getCurrentPlName() }), 'success');
      }
    });
  }, 'helpImport');

  register('track', ['t'], (args) => {
    const c = ctx();
    const sub = (args[0] || '').toLowerCase();
    const rest = args.slice(1);
    const pl = c.playlist;
    if (pl.length === 0) { c.printLine(t('playlistEmpty'), 'info'); return; }

    const buildTrackItems = (): InteractiveItem[] =>
      pl.map((fp, i) => ({ name: `${i + 1}. ${getFileName(fp)}`, path: fp, selected: false, visible: true }));

    const showInfo = async (trackPath: string) => {
      const name = getFileName(trackPath);
      c.printKV(t('trackInfoTitle') + ': ' + name, [[t('trackPath'), trackPath]]);
      const inPls = c.getPlaylistsForTrack(trackPath);
      c.printLine(t('trackInPlaylists') + ': ' + (inPls.length > 0 ? inPls.join(', ') : '-'), 'info');
      const allPls = c.listAllPlaylists().map(p => p.name);
      const notIn = allPls.filter(n => !inPls.includes(n));
      if (notIn.length > 0) c.printLine(t('trackNotInPlaylists') + ': ' + notIn.join(', '), 'dim');
    };

    const resolveTarget = (target: string, onSingle: (fp: string) => void) => {
      const n = parseInt(target, 10);
      if (!isNaN(n)) {
        if (n < 1 || n > pl.length) { c.printLine(t('trackInvalidNum'), 'error'); return; }
        onSingle(pl[n - 1]);
        return;
      }
      const results = fuzzySearch(target, pl);
      if (results.length === 0) { c.printLine(t('noMatch', { q: target }), 'error'); return; }
      if (results.length === 1) { onSingle(pl[results[0].idx]); return; }
      c.enterSelectMode(results.map(r => ({ idx: r.idx, name: r.name })));
    };

    const n = parseInt(sub, 10);
    if (!isNaN(n)) {
      if (n < 1 || n > pl.length) { c.printLine(t('trackInvalidNum'), 'error'); return; }
      showInfo(pl[n - 1]);
      return;
    }

    if (sub === 'info') {
      if (rest.length > 0) {
        resolveTarget(rest[0], fp => showInfo(fp));
      } else {
        const items = buildTrackItems();
        c.enterImode('track-select', items, (selected) => {
          for (const s of selected) { if (s.path) showInfo(s.path); }
        });
      }
      return;
    }

    // track pl/edit/delete/move/copy — delete/move/copy are shortcuts that normalize to pl
    if (sub === 'pl' || sub === 'edit' || sub === 'delete' || sub === 'move' || sub === 'copy') {
      const normalizedSub = (sub === 'delete' || sub === 'move' || sub === 'copy') ? 'pl' : sub;
      const normalizedRest = (sub === 'delete' || sub === 'move' || sub === 'copy') ? [sub, ...rest] : rest;
      const subSub = (normalizedRest[0] || '').toLowerCase();
      // track pl delete
      if (subSub === 'delete') {
        const items = buildTrackItems();
        c.enterImode('track-select', items, (tracks) => {
          const allNames = c.listAllPlaylists().map(p => p.name);
          c.printLine(t('trackPlDeleteTitle'), 'info');
          const plItems: InteractiveItem[] = allNames.map(name => ({ name, selected: false, visible: true }));
          c.enterImode('track-pl', plItems, (selectedPls) => {
            const plName = selectedPls[0]?.name;
            if (!plName) return;
            let count = 0;
            for (const t of tracks) {
              if (!t.path) continue;
              const plData = c.getPlaylistData(plName);
              if (plData && plData.tracks.includes(t.path)) {
                const inPls = c.getPlaylistsForTrack(t.path);
                const newPls = inPls.filter(p => p !== plName);
                c.syncTrackToPlaylists(t.path, newPls);
                count++;
              }
            }
            c.printLine(t('trackDeleted', { n: count, pl: plName }), 'success');
          });
        });
        return;
      }
      // track pl move
      if (subSub === 'move') {
        const items = buildTrackItems();
        c.enterImode('track-select', items, (tracks) => {
          const allNames = c.listAllPlaylists().map(p => p.name);
          c.printLine(t('trackPlMoveTitle'), 'info');
          const plItems: InteractiveItem[] = allNames.map(name => ({ name, selected: false, visible: true }));
          c.enterImode('track-pl', plItems, (selectedPls) => {
            const pls = selectedPls.map(s => s.name);
            const defaultPl = c.getCurrentPlName();
            const keep = new Set([...pls, defaultPl]);
            let count = 0;
            for (const t of tracks) {
              if (!t.path) continue;
              const current = c.getPlaylistsForTrack(t.path);
              c.syncTrackToPlaylists(t.path, [...new Set([...pls, ...current.filter(p => keep.has(p))])]);
              count++;
            }
            c.printLine(t('trackMoved', { n: count }), 'success');
          });
        });
        return;
      }
      // track pl copy
      if (subSub === 'copy') {
        const items = buildTrackItems();
        c.enterImode('track-select', items, (tracks) => {
          const allNames = c.listAllPlaylists().map(p => p.name);
          c.printLine(t('trackPlCopyTitle'), 'info');
          const plItems: InteractiveItem[] = allNames.map(name => ({ name, selected: false, visible: true }));
          c.enterImode('track-pl', plItems, (selectedPls) => {
            const pls = selectedPls.map(s => s.name);
            let count = 0;
            for (const t of tracks) {
              if (!t.path) continue;
              const current = c.getPlaylistsForTrack(t.path);
              c.syncTrackToPlaylists(t.path, [...new Set([...current, ...pls])]);
              count++;
            }
            c.printLine(t('trackCopied', { n: count }), 'success');
          });
        });
        return;
      }
      // track pl (legacy: with number target)
      if (normalizedRest.length > 0 && !subSub) {
        resolveTarget(normalizedRest[0], fp => {
          const inPls = c.getPlaylistsForTrack(fp);
          const allNames = c.listAllPlaylists().map(p => p.name);
          const plItems: InteractiveItem[] = allNames.map(name => ({ name, selected: inPls.includes(name), visible: true }));
          c.enterImode('track-pl', plItems, (selected) => {
            c.syncTrackToPlaylists(fp, selected.map(s => s.name));
            c.printLine(t('trackPlUpdated'), 'success');
          });
        });
        return;
      }
      // track pl (no args) — batch edit
      const items = buildTrackItems();
      c.enterImode('track-select', items, (tracks) => {
        const allNames = c.listAllPlaylists().map(p => p.name);
        const plItems: InteractiveItem[] = allNames.map(name => ({ name, selected: false, visible: true }));
        c.enterImode('track-pl', plItems, (selectedPls) => {
          const names = selectedPls.map(s => s.name);
          for (const t of tracks) {
            if (!t.path) continue;
            c.syncTrackToPlaylists(t.path, names);
          }
          c.printLine(t('trackPlUpdated'), 'success');
        });
      });
      return;
    }

    if (!sub) {
      const items = buildTrackItems();
      c.enterImode('track-select', items, (selected) => {
        for (const s of selected) { if (s.path) showInfo(s.path); }
      });
      return;
    }
    resolveTarget(sub, fp => showInfo(fp));
  }, 'helpTrack');

  register('info', ['meta', 'metadata'], async () => {
    const c = ctx();
    if (c.currentIndex < 0) { c.printLine(t('noTrackLoaded'), 'info'); return; }
    const meta = await readMetadata(c.playlist[c.currentIndex]);
    showMetadata(meta);
  }, 'helpInfo');

  register('list', ['ls'], () => {
    const c = ctx();
    const pl = c.playlist;
    if (pl.length === 0) { c.printLine(t('playlistEmpty'), 'info'); return; }
    c.printLine(`<cmd>${t('playlist')} (${pl.length} ${t('tracks')}):</cmd>`, 'accent');
    for (let i = 0; i < pl.length; i++) {
      const marker = i === c.currentIndex ? '>' : ' ';
      c.printRaw(`  ${marker} ${i + 1}. ${getFileName(pl[i])}`);
    }
  }, 'helpList');

  register('pl', [], (args) => {
    const c = ctx();
    const sub = (args[0] || '').toLowerCase();
    const rest = args.slice(1);

    if (sub === 'create' || sub === 'new') {
      if (rest.length === 0) { c.printLine(t('helpPlCreate'), 'info'); return; }
      const name = rest[0];
      const desc = rest.slice(1).join(' ');
      const r = c.createPlaylist(name, desc);
      if (r.error === 'duplicate') c.printLine(t('plDuplicate'), 'error');
      else c.printLine(t('plCreated', { name }), 'success');
    } else if (sub === 'list' || sub === 'ls') {
      const list = c.listAllPlaylists();
      if (list.length === 0) { c.printLine(t('plNoPlaylists'), 'info'); return; }
      c.printList(t('plTitle') + ' (' + String(list.length) + ')', list.map(p => ({
        name: p.name + (p.isCurrent ? ' ' + t('plIsCurrent') : ''),
        meta: p.trackCount + ' ' + t('tracks'),
        sub: (p.desc ? p.desc + '  —  ' : '') + new Date(p.createdAt).toLocaleDateString(),
        highlight: p.isCurrent,
      })));
    } else if (sub === 'delete' || sub === 'rm' || sub === 'del') {
      if (rest.length === 0) { c.printLine(t('helpPlDelete'), 'info'); return; }
      const name = rest.join(' ');
      const r = c.deletePlaylist(name);
      if (r.error === 'notFound') c.printLine(t('plNotFound'), 'error');
      else if (r.error === 'lastOne') c.printLine(t('plLastOne'), 'error');
      else c.printLine(t('plDeleted', { name }), 'success');
    } else if (sub === 'edit') {
      if (rest.length < 3) { c.printLine(t('helpPlEdit'), 'info'); return; }
      const r = c.editPlaylist(rest[0], rest[1], rest.slice(2).join(' '));
      if (r.error === 'notFound') c.printLine(t('plNotFound'), 'error');
      else if (r.error === 'duplicate') c.printLine(t('plDuplicate'), 'error');
      else if (r.error === 'badField') c.printLine(t('plBadField'), 'error');
      else c.printLine(t('plUpdated'), 'success');
    } else if (sub === 'info' || !sub) {
      const name = rest.length > 0 ? rest.join(' ') : c.getCurrentPlName();
      const info = c.getPlaylistData(name);
      if (!info) { c.printLine(t('plNotFound'), 'error'); return; }
      c.printLine(`<cmd>${t('plInfoHeader')}: ${info.name}</cmd>`, 'accent');
      c.printRaw('  ' + t('plDesc') + ': ' + (info.desc || '-'));
      c.printRaw('  ' + t('plTracks') + ': ' + info.tracks.length);
      c.printRaw('  ' + t('plCreated2') + ': ' + new Date(info.createdAt).toLocaleString());
      if (info.updatedAt) c.printRaw('  ' + t('plUpdatedAt') + ': ' + new Date(info.updatedAt).toLocaleString());
      if (info.sharer) c.printRaw('  ' + t('plSharer') + ': ' + info.sharer);
    } else {
      c.printLine(t('unknownCmd', { cmd: escapeHtml('pl ' + sub) }), 'error');
    }
  }, 'helpPlCreate');
}
