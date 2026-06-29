import { register } from '../registry';
import { ctx } from './index';
import { t } from '../../i18n';
import { getBridge } from '../../bridge';
import { getStoredSettings } from '../../contexts/SettingsContext';
import { formatTime } from '../../utils/format';
import { darken } from '../../utils/color';
import { hasError } from '../../utils/guards';

const COLOR_TYPE_MAP: Record<string, string> = {
  text: 'fg', fg: 'fg', dim: 'fg-dim', 'fg-dim': 'fg-dim',
  bright: 'fg-bright', 'fg-bright': 'fg-bright',
  accent: 'accent', hl: 'accent', bg: 'bg', background: 'bg',
  line: 'line', border: 'line', lyric: 'lyric',
};

function handleVol(args: string[]) {
  const c = ctx();
  const v = parseInt(args[0], 10);
  if (isNaN(v) || v < 0 || v > 100) {
    c.printLine(t('volumeUsage', { v: c.getVolume() }), 'info');
    return;
  }
  c.setVolume(v);
  c.saveSettings({ volume: v });
  c.printLine(t('volumeSet', { v }), 'success');
}

function handleColor(args: string[]) {
  const c = ctx();
  if (args.length === 0) {
    handleShowColors();
    return;
  }
  if (args.length < 2) {
    c.printLine(t('colorUsage'), 'info');
    c.printRaw('  ' + t('colorTypes'));
    c.printRaw('  ' + t('colorExample'));
    return;
  }
  const type = COLOR_TYPE_MAP[args[0].toLowerCase()];
  if (!type) {
    c.printLine(t('colorUnknown', { t: args[0] }), 'error');
    return;
  }
  const color = args[1];
  const validHex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(color);
  const validFunc = /^rgba?\s*\(/i.test(color);
  if (!validHex && !validFunc) {
    c.printLine(t('colorInvalid'), 'error');
    return;
  }
  let fullColor = color;
  if (/^#[0-9a-fA-F]{3}$/.test(color)) {
    fullColor = '#' + color[1] + color[1] + color[2] + color[2] + color[3] + color[3];
  }
  const partial: Record<string, unknown> = {};
  partial[type] = fullColor;
  if (type === 'bg') partial['bg-darker'] = darken(fullColor, 0.85);
  c.saveSettings(partial);
  c.printLine(t('colorSet', { type: args[0], hex: fullColor }), 'success');
}

function handleShowColors() {
  const s = getStoredSettings();
  ctx().printKV(t('colorsTitle'), [
    [t('tableBg'), s.bg],
    [t('tableText'), s.fg],
    [t('tableDim'), s['fg-dim']],
    [t('tableBright'), s['fg-bright']],
    [t('tableAccent'), s.accent],
    [t('tableLine'), s.line],
    [t('tableLyric'), s.lyric],
    [t('tableBlur'), s['bg-blur'] + 'px'],
    [t('tableImage'), s['bg-img'] ? t('tableYes') : t('tableNone')],
  ]);
}

async function handleBg(args: string[]) {
  const c = ctx();
  if (args[0] === 'clear' || args[0] === 'none' || args[0] === 'off') {
    c.saveSettings({ 'bg-img': '', 'bg-img-data': '' });
    c.printLine(t('bgCleared'), 'info');
    return;
  }
  const imgPath = await getBridge().selectImage();
  if (!imgPath) { c.printLine(t('bgNoImage'), 'info'); return; }
  c.saveSettings({ 'bg-img': imgPath });
  c.printLine(t('bgSet'), 'success');
}

function handleBlur(args: string[]) {
  const c = ctx();
  const v = parseInt(args[0], 10);
  if (isNaN(v) || v < 0 || v > 50) {
    c.printLine(t('blurUsage', { v: getStoredSettings()['bg-blur'] || 0 }), 'info');
    return;
  }
  c.saveSettings({ 'bg-blur': v });
  c.printLine(t('blurSet', { v }), 'success');
}

async function handleFont(args: string[]) {
  const c = ctx();
  const sub = (args[0] || '').toLowerCase();
  const s = getStoredSettings();
  if (sub === 'size') {
    const v = parseInt(args[1], 10);
    if (isNaN(v) || v < 10 || v > 32) { c.printLine(t('fontSizeUsage', { v: s.fontSize || 14 }), 'info'); return; }
    c.saveSettings({ fontSize: v });
    c.printLine(t('fontSizeSet', { v }), 'success');
  } else if (sub === 'weight') {
    const raw = args[1];
    if (!raw) { c.printLine(t('fontWeightUsage', { v: s.fontWeight || 400 }), 'info'); return; }
    const weightMap: Record<string, number> = { normal: 400, bold: 700, lighter: 300, bolder: 600 };
    const w = weightMap[raw.toLowerCase()] ?? parseInt(raw, 10);
    if (isNaN(w) || w < 100 || w > 900) { c.printLine(t('fontWeightUsage', { v: s.fontWeight || 400 }), 'info'); return; }
    c.saveSettings({ fontWeight: w });
    c.printLine(t('fontWeightSet', { v: w }), 'success');
  } else if (sub === 'import') {
    const fontPath = await getBridge().selectFont();
    if (!fontPath) { c.printLine(t('fontNoSelect'), 'info'); return; }
    const base64 = await getBridge().readFileBase64(fontPath);
    if (hasError(base64)) { c.printLine(t('fontImportSelect'), 'error'); return; }
    const ext = fontPath.split('.').pop()!.toLowerCase();
    const mimeMap: Record<string, string> = { ttf: 'font/truetype', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2' };
    const mime = mimeMap[ext] || 'font/truetype';
    const dataUrl = `data:${mime};base64,${base64}`;
    const fontName = fontPath.split(/[/\\]/).pop()!.replace(/\.[^.]+$/, '');
    c.saveSettings({ customFont: fontName, customFontData: dataUrl });
    c.printLine(t('fontImported', { name: fontName }), 'success');
  } else if (sub === 'clear' || sub === 'reset') {
    c.saveSettings({ customFont: '', customFontData: '' });
    c.printLine(t('fontReset'), 'info');
  } else {
    c.printLine(t('helpFont'), 'info');
  }
}

export function registerAppearanceCommands() {
  register('set', [], async (args) => {
    const c = ctx();
    const sub = (args[0] || '').toLowerCase();
    const rest = args.slice(1);
    if (sub === 'vol' || sub === 'volume') handleVol(rest);
    else if (sub === 'color') handleColor(rest);
    else if (sub === 'colors') handleShowColors();
    else if (sub === 'bg' || sub === 'background') await handleBg(rest);
    else if (sub === 'blur') handleBlur(rest);
    else if (sub === 'font') await handleFont(rest);
    else if (sub === 'maxlines') {
      const v = parseInt(rest[0], 10);
      if (isNaN(v) || v < 100 || v > 5000) {
        c.printLine(t('maxlinesUsage', { v: getStoredSettings().maxLines || 500 }), 'info');
        return;
      }
      c.saveSettings({ maxLines: v });
      c.printLine(t('maxlinesSet', { v }), 'success');
    }
    else c.printLine(t('setUsage'), 'info');
  }, 'helpSet');

  register('vol', ['volume'], (args) => handleVol(args), 'helpVol');
  register('color', ['setcolor'], (args) => handleColor(args), 'helpColor');
  register('colors', ['showcolors'], () => handleShowColors(), 'helpColors');
  register('bg', ['background', 'bgimage'], (args) => handleBg(args), 'helpBg');
  register('blur', ['bgblur'], (args) => handleBlur(args), 'helpBlur');
  register('font', [], (args) => handleFont(args), 'helpFont');

  register('progress', ['bar'], (args) => {
    const c = ctx();
    const sub = (args[0] || '').toLowerCase();
    const rest = args.slice(1);
    const s = getStoredSettings();

    if (sub === 'width') {
      const v = parseInt(rest[0], 10);
      if (isNaN(v) || v < 10 || v > 100) { c.printLine(t('progressWidthUsage', { v: s.progressWidth || 20 }), 'info'); return; }
      c.saveSettings({ progressWidth: v });
      c.printLine(t('progressWidthSet', { v }), 'success');
    } else if (sub === 'char' || sub === 'chars') {
      if (rest.length < 2) { c.printLine(t('progressCharUsage'), 'info'); return; }
      c.saveSettings({ progressFilled: rest[0], progressEmpty: rest[1] });
      c.printLine(t('progressCharSet', { f: rest[0], e: rest[1] }), 'success');
    } else {
      c.printLine(t('helpProgressSet'), 'info');
      c.printRaw(`  bar width: ${s.progressWidth ?? 20}`);
      c.printRaw(`  bar char:  "${s.progressFilled ?? '='}" "${s.progressEmpty ?? ' '}"`);
    }
  }, 'helpProgress');

  register('mode', ['loop', 'repeat'], () => {
    const c = ctx();
    const mode = c.cyclePlayMode();
    const modeKey = 'mode' + mode.charAt(0).toUpperCase() + mode.slice(1).replace(/-./g, x => x[1].toUpperCase());
    c.printLine(t('modeChanged', { mode: t(modeKey) }), 'success');
  }, 'helpMode');

  register('seek', ['goto'], (args) => {
    const c = ctx();
    const sub = (args[0] || '').toLowerCase();

    if (sub === 'step') {
      const v = parseInt(args[1], 10);
      if (isNaN(v) || v < 1 || v > 60) {
        c.printLine(t('seekStepUsage', { v: getStoredSettings().seekStep || 5 }), 'info');
        return;
      }
      c.saveSettings({ seekStep: v });
      c.printLine(t('seekStepSet', { v }), 'success');
      return;
    }

    if (sub === 'pause') {
      const val = (args[1] || '').toLowerCase();
      if (val === 'on' || val === 'true' || val === '1') {
        c.saveSettings({ seekPause: true });
        c.printLine(t('seekPauseOn'), 'success');
      } else if (val === 'off' || val === 'false' || val === '0') {
        c.saveSettings({ seekPause: false });
        c.printLine(t('seekPauseOff'), 'success');
      } else {
        c.printLine(t('seekPauseUsage'), 'info');
      }
      return;
    }

    const s = parseFloat(args[0]);
    if (!isNaN(s)) {
      c.seek(s);
      c.printLine(t('seekSet', { t: formatTime(s) }), 'success');
      return;
    }

    const step = getStoredSettings().seekStep || 5;
    c.enterSeekMode();
    c.printLine(t('seekModeEnter', { step }), 'success');
  }, 'helpSeek');
}
