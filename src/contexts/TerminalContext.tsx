import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
import type { OutputLine, SelectCandidate, InteractiveItem } from '../types';

type InteractiveMode = 'import' | 'track-pl' | null;
import { getStoredSettings } from './SettingsContext';
import { escapeHtml } from '../utils/format';
import { t } from '../i18n';

type InteractiveCallback = (selected: InteractiveItem[]) => void;

// Standalone helpers (not memoized, no closures — always read latest state)
export function filterItems(items: InteractiveItem[], query: string): InteractiveItem[] {
  const q = query.toLowerCase();
  if (!q) return items;
  return items.filter(it => it.name.toLowerCase().includes(q));
}

export function getVisibleIdxFn(items: InteractiveItem[], cursorIdx: number): number {
  const vis = items.filter(it => it.visible);
  if (vis.length === 0) return -1;
  return vis.indexOf(items[cursorIdx]);
}

interface TerminalContextValue {
  lines: OutputLine[];
  printLine: (text: string, className?: string) => void;
  printRaw: (text: string) => void;
  printKV: (title: string | null, pairs: [string, string | number | null][]) => void;
  printList: (title: string | null, items: { name: string; meta?: string; sub?: string; highlight?: boolean }[]) => void;
  printHelp: () => void;
  clearTerminal: () => void;
  // Fuzzy select mode
  selectMode: boolean;
  selectCandidates: SelectCandidate[];
  selectIdx: number;
  enterSelectMode: (candidates: SelectCandidate[]) => void;
  exitSelectMode: () => void;
  setSelectIdx: (idx: number) => void;
  // Interactive mode
  imode: InteractiveMode;
  iitems: InteractiveItem[];
  iidx: number;
  ifilter: string;
  enterImode: (mode: InteractiveMode, items: InteractiveItem[], cb: InteractiveCallback) => void;
  exitImode: () => void;
  setIidx: (idx: number) => void;
  updateFilter: (newFilter: string) => void;
  toggleIitem: (idx: number) => void;
  moveCursor: (delta: number) => void;
  imodeCallback: InteractiveCallback | null;
  // Seek mode
  seekMode: boolean;
  enterSeekMode: () => void;
  exitSeekMode: () => void;
}

let nextId = 1;

const TerminalContext = createContext<TerminalContextValue | null>(null);

export function TerminalProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<OutputLine[]>([]);
  const [selectMode, setSelectMode] = useState(false);
  const [selectCandidates, setSelectCandidates] = useState<SelectCandidate[]>([]);
  const [selectIdx, setSelectIdx] = useState(0);
  const [imode, setImode] = useState<InteractiveMode>(null);
  const [items, setItems] = useState<InteractiveItem[]>([]);
  const [iidx, setIidx] = useState(0);
  const [ifilter, setIfilter] = useState('');
  const imodeCallbackRef = useRef<InteractiveCallback | null>(null);
  const itemsRef = useRef<InteractiveItem[]>([]);
  const [seekMode, setSeekMode] = useState(false);

  // Keep ref in sync with state so moveCursor can read latest value
  useEffect(() => { itemsRef.current = items; }, [items]);

  const trimExcess = (arr: OutputLine[]): OutputLine[] => {
    const max = getStoredSettings().maxLines || 500;
    return arr.length > max ? arr.slice(arr.length - max) : arr;
  };

  const printLine = useCallback((text: string, className = '') => {
    setLines(prev => trimExcess([...prev, { id: nextId++, text, className, raw: false }]));
  }, []);

  const printRaw = useCallback((text: string) => {
    setLines(prev => trimExcess([...prev, { id: nextId++, text, className: '', raw: true }]));
  }, []);

  const printKV = useCallback((title: string | null, pairs: [string, string | number | null][]) => {
    printRaw('');
    if (title) printLine(`<cmd>${title}</cmd>`, 'accent');
    let maxLen = 0;
    for (const [label] of pairs) {
      if (label.length > maxLen) maxLen = label.length;
    }
    for (const [label, value] of pairs) {
      const padded = label.padEnd(maxLen + 2);
      const v = value != null ? String(value) : '-';
      printRaw(`  ${padded}: ${v}`);
    }
  }, [printLine, printRaw]);

  const printList = useCallback((title: string | null, itemList: { name: string; meta?: string; sub?: string; highlight?: boolean }[]) => {
    printRaw('');
    if (title) printLine(`<cmd>${title}</cmd>`, 'accent');
    for (const item of itemList) {
      const prefix = item.highlight ? '> ' : '  ';
      const metaStr = item.meta ? '  ·  ' + item.meta : '';
      printRaw(prefix + escapeHtml(item.name) + metaStr);
      if (item.sub) printRaw('     ' + item.sub);
    }
  }, [printLine, printRaw]);

  const printHelp = useCallback(() => {
    printRaw('');
    printLine(`<cmd>${t('helpTitle')}</cmd>`, 'accent');
    printLine('  ' + t('helpGroupFile'), 'dim');
    printRaw('    open                  ' + t('helpOpen'));
    printRaw('    open dir              ' + t('helpFolder'));
    printRaw('    import                ' + t('helpImport'));
    printLine('  ' + t('helpGroupPlayback'), 'dim');
    printRaw('    play [n|name]         ' + t('helpPlay'));
    printRaw('    pause | stop          ' + t('helpPause') + ' / ' + t('helpStop'));
    printRaw('    next | prev           ' + t('helpNext') + ' / ' + t('helpPrev'));
    printRaw('    mode                  ' + t('helpMode'));
    printRaw('    vol <0-100>           ' + t('helpVol'));
    printRaw('    seek <seconds>        ' + t('helpSeek'));
    printLine('  ' + t('helpGroupDisplay'), 'dim');
    printRaw('    list                  ' + t('helpList'));
    printRaw('    info                  ' + t('helpInfo'));
    printRaw('    lyric t|f|off          ' + t('helpLyric'));
    printRaw('    lyric next <n>        ' + t('helpLyricNext'));
    printRaw('    lyric gap <px>        ' + t('helpLyricGap'));
    printRaw('    lyric accent|fg <hex> ' + t('helpLyricColor'));
    printRaw('    lyric shadow <s|m|l>  ' + t('helpLyricShadow'));
    printRaw('    lyric align <l|c|r>   ' + t('helpLyricAlign'));
    printRaw('    lyric lock            ' + t('helpLyricLock'));
    printRaw('    bar [width|char]      ' + t('helpProgress'));
    printLine('  ' + t('helpGroupPl'), 'dim');
    printRaw('    cd [name]             ' + t('helpCd'));
    printRaw('    pl create|list|delete|edit|info');
    printRaw('    track info|pl <n>     ' + t('helpTrack'));
    printLine('  ' + t('helpGroupAppearance'), 'dim');
    printRaw('    set vol <0-100>       ' + t('helpVol'));
    printRaw('    set color [<t> <#hex>]  ' + t('helpColor'));
    printRaw('    set bg [clear]        ' + t('helpBg'));
    printRaw('    set blur <0-50>       ' + t('helpBlur'));
    printRaw('    set font size|weight|import|clear');
    printRaw('    theme list|save|load|delete|export|import  ' + t('helpTheme'));
    printLine('  ' + t('helpGroupSystem'), 'dim');
    printRaw('    lang <en|zh|ja>       ' + t('helpLang'));
    printRaw('    reset                 ' + t('helpReset'));
    printRaw('    clear                 ' + t('helpClear'));
    printRaw('    help                  ' + t('helpHelp'));
    printRaw('    quit                  ' + t('helpQuit'));
    printRaw('');
  }, [printLine, printRaw]);

  const clearTerminal = useCallback(() => {
    setLines([]);
  }, []);

  const enterSelectMode = useCallback((candidates: SelectCandidate[]) => {
    setSelectMode(true);
    setSelectCandidates(candidates);
    setSelectIdx(0);
  }, []);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectCandidates([]);
    setSelectIdx(0);
  }, []);

  const enterImode = useCallback((mode: InteractiveMode, itemList: InteractiveItem[], cb: InteractiveCallback) => {
    setImode(mode);
    setItems(itemList.map(it => ({ ...it, visible: true, selected: it.selected ?? false })));
    setIidx(0);
    setIfilter('');
    imodeCallbackRef.current = cb;
    setSelectMode(false);
    // Ensure input stays focused
    setTimeout(() => document.getElementById('cmd-input')?.focus(), 0);
  }, []);

  const exitImode = useCallback(() => {
    setImode(null);
    setItems([]);
    setIidx(0);
    setIfilter('');
    imodeCallbackRef.current = null;
  }, []);

  const enterSeekMode = useCallback(() => {
    setSeekMode(true);
    setSelectMode(false);
    if (imode) exitImode();
  }, [imode, exitImode]);

  const exitSeekMode = useCallback(() => {
    setSeekMode(false);
  }, []);

  const toggleIitem = useCallback((idx: number) => {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, selected: !it.selected } : it));
  }, []);

  // Atomic filter update — takes new value as parameter, no closure on ifilter
  const updateFilter = useCallback((newFilter: string) => {
    setIfilter(newFilter);
    const q = newFilter.toLowerCase();
    setItems(prev => prev.map(it => ({
      ...it,
      visible: !q || it.name.toLowerCase().includes(q),
    })));
  }, []);

  // Read items from ref to avoid React StrictMode double-invocation of nested setters
  const moveCursor = useCallback((delta: number) => {
    const curItems = itemsRef.current;
    setIidx(prevIidx => {
      const vis = curItems.filter(it => it.visible);
      if (vis.length === 0) return prevIidx;
      const curVisIdx = vis.indexOf(curItems[prevIidx]);
      if (curVisIdx < 0) return curItems.indexOf(vis[0]);
      const nextVisIdx = (curVisIdx + delta + vis.length) % vis.length;
      return curItems.indexOf(vis[nextVisIdx]);
    });
  }, []);

  return (
    <TerminalContext.Provider value={{
      lines,
      printLine, printRaw, printKV, printList, printHelp,
      clearTerminal,
      selectMode, selectCandidates, selectIdx,
      enterSelectMode, exitSelectMode, setSelectIdx,
      imode, iitems: items, iidx, ifilter,
      enterImode, exitImode,
      setIidx, updateFilter, toggleIitem,
      moveCursor,
      imodeCallback: imodeCallbackRef.current,
      seekMode,
      enterSeekMode,
      exitSeekMode,
    }}>
      {children}
    </TerminalContext.Provider>
  );
}

export function useTerminal() {
  const ctx = useContext(TerminalContext);
  if (!ctx) throw new Error('useTerminal must be used within TerminalProvider');
  return ctx;
}
