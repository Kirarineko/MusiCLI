import { register } from '../registry';
import { ctx, readMetadata, printNowPlaying, showMetadata } from './index';
import { t } from '../../i18n';
import { getBridge } from '../../bridge';
import { getStoredSettings } from '../../contexts/SettingsContext';
import { escapeHtml, getFileName } from '../../utils/format';
import { refreshPlaylists } from '../../configStore';
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
    // c.playlist is a snapshot from before addTracksToCurrent, so indexOf
    // would return -1. Defer the play call so the player state has updated.
    const firstFile = files[0];
    setTimeout(async () => {
      const c2 = ctx();
      const idx = c2.playlist.indexOf(firstFile);
      if (idx >= 0) {
        const fp = c2.playIndex(idx);
        if (fp) {
          const meta = await readMetadata(fp);
          if (meta) { printNowPlaying(meta); await c2.loadLRC(fp); }
        }
      }
    }, 0);
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
      // Escape playlist names — they are user-controlled and flow into SafeHtml.
      c.printLine(t('trackInPlaylists') + ': ' + (inPls.length > 0 ? inPls.map(escapeHtml).join(', ') : '-'), 'info');
      const allPls = c.listAllPlaylists().map(p => p.name);
      const notIn = allPls.filter(n => !inPls.includes(n));
      if (notIn.length > 0) c.printLine(t('trackNotInPlaylists') + ': ' + notIn.map(escapeHtml).join(', '), 'dim');
      // Tags are user/LLM input flowing into SafeHtml — escape them too.
      const mf = getStoredSettings().musicFolder || '';
      if (mf) {
        const tags = await getBridge().getTrackTags(mf, trackPath);
        if (!hasError(tags) && tags.length > 0) {
          c.printLine(t('trackTags') + ': ' + tags.map(escapeHtml).join(', '), 'info');
        }
      }
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

    // track tag — manage sidecar tags (add/rm/list/auto)
    if (sub === 'tag') {
      const mf = getStoredSettings().musicFolder || '';
      if (!mf) { c.printLine(t('importNoFolder'), 'info'); return; }
      const action = (rest[0] || '').toLowerCase();

      const printTags = async (fp: string) => {
        const tags = await getBridge().getTrackTags(mf, fp);
        if (hasError(tags)) { c.printLine(escapeHtml(tags.error), 'error'); return; }
        c.printLine(`${getFileName(fp)}: ` + (tags.length > 0 ? tags.map(escapeHtml).join(', ') : '-'), 'info');
      };

      // track tag add|rm <target> <tag...>
      if (action === 'add' || action === 'rm' || action === 'remove') {
        if (rest.length < 3) { c.printLine(t('trackTagUsage'), 'info'); return; }
        const newTags = rest.slice(2);
        resolveTarget(rest[1], (fp) => {
          void (async () => {
            const cur = await getBridge().getTrackTags(mf, fp);
            if (hasError(cur)) { c.printLine(escapeHtml(cur.error), 'error'); return; }
            let next: string[];
            if (action === 'add') {
              next = [...cur, ...newTags];
            } else {
              const rm = new Set(newTags.map(s => s.toLowerCase()));
              next = cur.filter(tg => !rm.has(tg.toLowerCase()));
            }
            const r = await getBridge().setTrackTags(mf, fp, next);
            if (hasError(r)) { c.printLine(escapeHtml(r.error!), 'error'); return; }
            c.printLine(t('trackTagUpdated', { name: getFileName(fp) }), 'success');
            await printTags(fp);
          })();
        });
        return;
      }

      // track tag list [target] — all tagged tracks, or one track
      if (action === 'list' || action === 'ls') {
        if (rest.length > 1) { resolveTarget(rest[1], fp => void printTags(fp)); return; }
        void (async () => {
          let shown = 0;
          for (const fp of pl) {
            const tags = await getBridge().getTrackTags(mf, fp);
            if (!hasError(tags) && tags.length > 0) {
              c.printLine(`  ${getFileName(fp)}: ` + tags.map(escapeHtml).join(', '), 'info');
              shown++;
            }
          }
          if (shown === 0) c.printLine(t('trackTagNone'), 'info');
        })();
        return;
      }

      // track tag auto [target|all] — LLM auto-tagging
      if (action === 'auto') {
        const settings = getStoredSettings();
        if (!settings.llmBaseUrl || !settings.llmModel) { c.printLine(t('llmNotConfigured'), 'info'); return; }
        const autoTag = async (fp: string) => {
          const name = getFileName(fp);
          c.printLine(t('trackTagAutoStart', { name }), 'dim');
          try {
            const meta = await readMetadata(fp);
            let lyrics = '';
            const lrc = await getBridge().findLrc(fp, mf);
            if (typeof lrc === 'string' && lrc) {
              const content = await getBridge().readFile(lrc);
              if (typeof content === 'string') lyrics = content;
            }
            const { invoke } = await import('@tauri-apps/api/core');
            // Tag library: existing tags across the whole library, so the LLM
            // reuses spellings instead of inventing plural/synonym variants.
            const existingTags = await invoke<string[]>('tags_all', { musicFolder: mf }).catch(() => [] as string[]);
            const tags = await invoke<string[]>('llm_generate_tags', {
              baseUrl: settings.llmBaseUrl,
              apiKey: settings.llmApiKey,
              model: settings.llmModel,
              title: meta?.title || name,
              artist: meta?.artist || '',
              lyrics,
              audioPath: fp,
              useAudio: !!settings.llmAudio,
              existingTags,
            });
            if (tags.length === 0) { c.printLine(t('trackTagAutoEmpty', { name }), 'info'); return; }
            const cur = await getBridge().getTrackTags(mf, fp);
            const merged = [...(hasError(cur) ? [] : cur), ...tags];
            const r = await getBridge().setTrackTags(mf, fp, merged);
            if (hasError(r)) { c.printLine(escapeHtml(r.error!), 'error'); return; }
            c.printLine(t('trackTagAutoDone', { name, tags: tags.map(escapeHtml).join(', ') }), 'success');
          } catch (err) {
            c.printLine(escapeHtml(String(err)), 'error');
          }
        };
        const target = rest[1] || '';
        if (target.toLowerCase() === 'all') {
          void (async () => { for (const fp of pl) await autoTag(fp); })();
          return;
        }
        if (target) { resolveTarget(target, fp => void autoTag(fp)); return; }
        const items = buildTrackItems();
        c.enterImode('track-select', items, (selected) => {
          void (async () => {
            for (const s of selected) { if (s.path) await autoTag(s.path); }
          })();
        });
        return;
      }

      // track tag <n|name> — show tags for one track
      if (rest.length > 0) { resolveTarget(rest[0], fp => void printTags(fp)); return; }
      c.printLine(t('trackTagUsage'), 'info');
      return;
    }

    // track pl/edit/delete/move/copy — delete/move/copy are shortcuts that normalize to pl
    if (sub === 'pl' || sub === 'edit' || sub === 'delete' || sub === 'move' || sub === 'copy') {
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
    } else if (sub === 'refresh' || sub === 'reload') {
      refreshPlaylists().then(ok => {
        if (ok) {
          c.printLine(t('plRefreshOk'), 'success');
          // Reload current playlist tracks from file into flat queue
          const data = c.getCurrentPlaylist();
          if (data && data.tracks.length > 0) {
            c.replaceCurrentTracks(data.tracks);
          }
        } else {
          c.printLine(t('plRefreshFail'), 'error');
        }
      });
    } else {
      c.printLine(t('unknownCmd', { cmd: escapeHtml('pl ' + sub) }), 'error');
    }
  }, 'helpPlCreate');
}
