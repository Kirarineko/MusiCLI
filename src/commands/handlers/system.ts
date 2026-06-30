import { register } from '../registry';
import { ctx } from './index';
import { t } from '../../i18n';
import { getBridge } from '../../bridge';
import { getStoredSettings } from '../../contexts/SettingsContext';
import { hasError } from '../../utils/guards';

export function registerSystemCommands() {
  register('lang', ['language', 'locale'], (args) => {
    const c = ctx();
    const lang = (args[0] || '').toLowerCase();
    if (!['en', 'zh', 'ja'].includes(lang)) { c.printLine(t('langUsage'), 'info'); return; }
    if (c.setLangFn(lang)) {
      c.clearTerminal();
      c.setVolume(c.getVolume());
      c.printLine(t('langSet', { lang }), 'success');
    }
  }, 'helpLang');

  register('help', ['?', 'h'], () => ctx().printHelp(), 'helpHelp');
  register('clear', ['cls'], () => ctx().clearTerminal(), 'helpClear');

  register('reset', [], () => {
    const c = ctx();
    c.resetSettings();
    c.printLine(t('resetDone'), 'success');
  }, 'helpReset');

  register('quit', ['exit', 'q'], () => getBridge().close(), 'helpQuit');

  register('audio', ['aud'], async (args) => {
    const c = ctx();
    const sub = (args[0] || '').toLowerCase();
    if (sub === 'mode') {
      const modeArg = (args[1] || '').toLowerCase();
      if (modeArg === 'normal' || modeArg === 'default' || modeArg === 'wasapi' || modeArg === 'w') {
        try {
          const result = await getBridge().setAudioMode('normal');
          c.printLine(result, 'success');
        } catch (err) { c.printLine(String(err), 'error'); }
      } else if (modeArg === 'asio' || modeArg === 'exclusive' || modeArg === 'a') {
        try {
          const result = await getBridge().setAudioMode('asio');
          c.printLine(result, 'success');
        } catch (err) { c.printLine(String(err), 'error'); }
      } else {
        try {
          const current = await getBridge().getAudioMode();
          c.printLine(`<cmd>Audio Mode:</cmd> ${current}`, 'info');
          c.printRaw('  normal     - System audio (default)');
          c.printRaw('  asio       - ASIO exclusive (requires ASIO drivers)');
        } catch (err) { c.printLine(String(err), 'error'); }
      }
    } else if (sub === 'devices') {
      try {
        const devices = await getBridge().listAudioDevices();
        c.printLine('<cmd>Audio Devices:</cmd>', 'accent');
        devices.forEach((d, i) => c.printRaw(`  ${i + 1}. ${d}`));
      } catch (err) { c.printLine(String(err), 'error'); }
    } else {
      c.printLine('Usage: audio mode [normal|asio] | audio devices', 'info');
    }
  }, 'helpAudio');

  register('remote', ['rmt'], async (args) => {
    const c = ctx();
    const sub = (args[0] || '').toLowerCase();
    type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
    const invokeFn: InvokeFn = (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__)
      ? (await import('@tauri-apps/api/core')).invoke as InvokeFn
      : () => Promise.reject('Not in Tauri');
    try {
      const result = await invokeFn(sub === 'start' ? 'remote_start' : sub === 'stop' ? 'remote_stop' : 'remote_status');
      c.printLine(String(result), 'info');
    } catch (err) {
      c.printLine(String(err), 'error');
    }
  }, 'helpRemote');

  register('listen', ['lt'], async (args) => {
    const c = ctx();
    const port = (window as unknown as Record<string, number>).__MUSICLI_PORT__;
    if (!port) {
      c.printLine(t('listenServerNotRunning'), 'error');
      return;
    }
    const host = window.location.hostname || '127.0.0.1';
    const url = `http://${host}:${port}/listen`;

    const sub = (args[0] || '').toLowerCase();

    // --- listen ui — manage custom webui ---
    if (sub === 'ui') {
      const settings = getStoredSettings();
      const mf = settings.musicFolder;
      if (!mf) {
        c.printLine(t('importNoFolder'), 'info');
        return;
      }

      const webuiDir = `${mf.replace(/\/$/, '')}/Listen_WebUI`;
      const exists = await getBridge().dirExists(webuiDir);

      // Read current selection from config
      const currentRaw = await getBridge().readConfig(mf, 'listen-webui');
      const currentFile = typeof currentRaw === 'string' ? currentRaw : '';

      const action = (args[1] || '').toLowerCase();

      // listen ui default — reset to built-in webui
      if (action === 'default') {
        await getBridge().writeConfig(mf, 'listen-webui', '');
        c.printLine(t('listenUiReset'), 'success');
        return;
      }

      // listen ui / listen ui list — show available HTML files
      if (!action || action === 'list') {
        if (!exists) {
          c.printLine(t('listenUiDirNotFound', { path: webuiDir }), 'info');
          return;
        }
        const files = await getBridge().listListenWebuis(mf);
        if (hasError(files) || !files || files.length === 0) {
          c.printLine(t('listenUiNoFiles'), 'info');
          return;
        }
        c.printLine(`<cmd>${t('listenUiTitle')}</cmd>`, 'accent');
        for (let i = 0; i < files.length; i++) {
          const mark = files[i] === currentFile ? ' <cmd>*</cmd>' : '';
          c.printLine(`  ${i + 1}. ${files[i]}${mark}`);
        }
        c.printRaw('');
        if (currentFile) {
          c.printLine(`  ${t('listenUiSelected', { name: currentFile })}`, 'dim');
        }
        c.printRaw(t('listenUiHint'));
        return;
      }

      // listen ui <n> | <filename> — select a webui
      const files = exists ? await getBridge().listListenWebuis(mf) : [];
      if (hasError(files) || !files || files.length === 0) {
        c.printLine(t('listenUiNoFiles'), 'info');
        return;
      }

      let targetFile = '';
      if (/^\d+$/.test(action)) {
        const idx = parseInt(action, 10) - 1;
        if (idx >= 0 && idx < files.length) {
          targetFile = files[idx];
        }
      } else {
        const match = files.find(f => f.toLowerCase() === action || f.toLowerCase().endsWith('/' + action));
        if (match) {
          targetFile = match;
        }
      }

      if (!targetFile) {
        c.printLine(t('listenUiNotFound', { name: action }), 'error');
        return;
      }

      await getBridge().writeConfig(mf, 'listen-webui', targetFile);
      c.printLine(t('listenUiSelected', { name: targetFile }), 'success');
      return;
    }

    // --- listen (no subcommand) — show URL ---
    c.printLine(t('listenStarted'), 'success');
    c.printRaw(`  <cmd>${url}</cmd>`);
    c.printRaw(t('listenShareHint'));
    c.printRaw('');
    c.printRaw(t('listenLanHint'));
    c.printRaw(t('listenWanHint'));
  }, 'helpListen');
}
