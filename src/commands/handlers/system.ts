import { register } from '../registry';
import { ctx } from './index';
import { t } from '../../i18n';
import { getBridge } from '../../bridge';

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

  register('listen', ['lt'], () => {
    const c = ctx();
    const port = (window as unknown as Record<string, number>).__MUSICLI_PORT__;
    if (!port) {
      c.printLine('HTTP server not running', 'error');
      return;
    }
    const host = window.location.hostname || '127.0.0.1';
    const url = `http://${host}:${port}/listen`;
    c.printLine('一起听已开启：', 'success');
    c.printRaw(`  <cmd>${url}</cmd>`);
    c.printRaw('  将链接发送给对方即可加入');
    c.printRaw('');
    c.printRaw('  提示：对方需要在同一局域网内');
    c.printRaw('  如需外网访问，请使用内网穿透工具');
  }, 'helpListen');
}
