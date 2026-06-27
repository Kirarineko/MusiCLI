import { t } from '../i18n';

export function printHelp(
  printLine: (text: string, className?: string) => void,
  printRaw: (text: string) => void,
  _maxWidth: number
): void {
  printRaw('');
  printLine(`<cmd>${t('helpTitle')}</cmd>`, 'accent');
  printLine('  ' + t('helpGroupFile'), 'dim');
  printRaw('    open                  ' + t('helpOpen'));
  printRaw('    open dir              ' + t('helpFolder'));
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
  printRaw('    lyric size cur|n <px> ' + t('helpLyricSize'));
  printRaw('    lyric align <l|c|r>   ' + t('helpLyricAlign'));
  printRaw('    lyric lock            ' + t('helpLyricLock'));
  printRaw('    lyric v               ' + t('helpLyricVertical'));
  printRaw('    lyric offset <ms>     ' + t('helpLyricOffset'));
  printRaw('    bar [width|char]      ' + t('helpProgress'));
  printLine('  ' + t('helpGroupPl'), 'dim');
  printRaw('    cd [name]             ' + t('helpCd'));
  printRaw('    pl create|list|delete|edit|info');
  printRaw('    track|t info|pl|del|move|copy [n]  ' + t('helpTrack'));
  printRaw('    import                ' + t('helpImport'));
  printLine('  ' + t('helpGroupAppearance'), 'dim');
  printRaw('    set vol <0-100>       ' + t('helpVol'));
  printRaw('    colors                ' + t('helpColors'));
  printRaw('    set color [<t> <#hex>]  ' + t('helpColor'));
  printRaw('    set bg [clear]        ' + t('helpBg'));
  printRaw('    set blur <0-50>       ' + t('helpBlur'));
  printRaw('    set font size|weight|import|clear');
  printRaw('    set maxlines <n>      ' + t('helpMaxlines'));
  printRaw('    sync theme save|load|list|delete|export|import  ' + t('helpSync'));
  printLine('  ' + t('helpGroupSystem'), 'dim');
  printRaw('    lang <en|zh|ja>       ' + t('helpLang'));
  printRaw('    reset                 ' + t('helpReset'));
  printRaw('    clear                 ' + t('helpClear'));
  printRaw('    help                  ' + t('helpHelp'));
  printRaw('    quit                  ' + t('helpQuit'));
  printRaw('');
}
