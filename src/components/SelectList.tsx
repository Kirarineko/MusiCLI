import { useEffect, useRef, useCallback } from 'react';
import { useTerminal, filterItems, getVisibleIdxFn } from '../contexts/TerminalContext';
import { t } from '../i18n';
import { escapeHtml } from '../utils/format';

export function SelectList() {
  const {
    selectMode, selectCandidates, selectIdx, setSelectIdx,
    imode, iitems, iidx, ifilter,
    moveCursor,
  } = useTerminal();
  const elRef = useRef<HTMLDivElement>(null);

  // Scroll cursor into view on every render
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const cursorEl = el.querySelector('.imode-cursor');
    if (cursorEl) cursorEl.scrollIntoView({ block: 'nearest' });
  });

  // Mouse wheel changes cursor position
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    if (imode) {
      moveCursor(e.deltaY > 0 ? 1 : -1);
    } else if (selectMode && selectCandidates.length > 0) {
      setSelectIdx(Math.max(0, Math.min(
        selectCandidates.length - 1,
        selectIdx + (e.deltaY > 0 ? 1 : -1)
      )));
    }
  }, [imode, selectMode, selectCandidates.length, selectIdx, moveCursor, setSelectIdx]);

  const visible = selectMode || imode !== null;
  if (!visible) return null;

  let html = '';

  if (imode) {
    const vis = filterItems(iitems, ifilter);
    const selected = iitems.filter(it => it.selected).length;
    const title = imode === 'import' ? t('importTitle') : t('trackPlTitle');
    html += `<cmd>${escapeHtml(title)} (${selected} ${t('selected')})</cmd>`;
    if (ifilter) html += `  —  <cmd>${escapeHtml(ifilter)}</cmd>`;
    html += '<br><div class="sep-line"></div>';
    const visIdx = getVisibleIdxFn(iitems, iidx);
    for (let i = 0; i < vis.length; i++) {
      const it = vis[i];
      const marker = i === visIdx ? '>' : ' ';
      const check = it.selected ? '[*]' : '[ ]';
      const cls = i === visIdx ? ' class="imode-cursor"' : '';
      html += `<div${cls}>${marker} ${check} ${escapeHtml(it.name)}</div>`;
    }
    html += '<div class="sep-line"></div>';
    html += escapeHtml(imode === 'import' ? t('importHint') : t('trackPlHint'));
  } else if (selectMode) {
    for (let i = 0; i < selectCandidates.length; i++) {
      const c = selectCandidates[i];
      const marker = i === selectIdx ? '>' : ' ';
      const cls = i === selectIdx ? ' class="imode-cursor"' : '';
      html += `<div${cls}>${marker} ${c.idx + 1}. ${escapeHtml(c.name)}</div>`;
    }
  }

  return (
    <div
      id="select-list"
      ref={elRef}
      onWheel={handleWheel}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
