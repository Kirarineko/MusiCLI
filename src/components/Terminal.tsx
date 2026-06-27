import { useEffect, useRef } from 'react';
import { useTerminal } from '../contexts/TerminalContext';
import { t } from '../i18n';
import { SafeHtml } from './SafeHtml';

export function Terminal() {
  const { lines } = useTerminal();
  const outputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [lines]);

  return (
    <div id="output" ref={outputRef} onClick={() => document.getElementById('cmd-input')?.focus()}>
      <div className="banner">{t('banner')}</div>
      {lines.map(line => (
        line.raw ? (
          <div key={line.id} className={'line ' + line.className}>{line.text}</div>
        ) : (
          <div key={line.id} className={'line ' + line.className}>
            <SafeHtml html={line.text} />
          </div>
        )
      ))}
    </div>
  );
}
