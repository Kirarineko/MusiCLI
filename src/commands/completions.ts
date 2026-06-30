// Command argument completions: key is the space-separated command chain (lowercase),
// value is the array of valid next words.
export const subCompletions: Record<string, string[]> = {
  sync: ['pl', 'playlist', 'theme'],
  share: ['pl', 'playlist', 'theme'],
  'sync pl': ['export', 'import'],
  'sync playlist': ['export', 'import'],
  'sync theme': ['save', 'load', 'apply', 'switch', 'list', 'ls', 'delete', 'rm', 'del', 'export', 'import'],
  'share pl': ['export', 'import'],
  'share playlist': ['export', 'import'],
  'share theme': ['save', 'load', 'apply', 'switch', 'list', 'ls', 'delete', 'rm', 'del', 'export', 'import'],

  pl: ['create', 'new', 'list', 'ls', 'delete', 'rm', 'del', 'edit', 'info'],

  set: ['vol', 'volume', 'color', 'colors', 'bg', 'background', 'blur', 'font', 'maxlines'],

  track: ['info', 'pl', 'edit', 'delete', 'move', 'copy'],
  t: ['info', 'pl', 'edit', 'delete', 'move', 'copy'],
  'track pl': ['delete', 'move', 'copy'],
  't pl': ['delete', 'move', 'copy'],

  lyric: ['t', 'terminal', 'term', 'inline', 'f', 'floating', 'float', 'desktop', 'off', 'hide', 'disable', 'accent', 'fg', 'next', 'gap', 'size', 'align', 'offset', 'v', 'vertical', 'lock', 'shadow'],
  lyrics: ['t', 'terminal', 'term', 'inline', 'f', 'floating', 'float', 'desktop', 'off', 'hide', 'disable', 'accent', 'fg', 'next', 'gap', 'size', 'align', 'offset', 'v', 'vertical', 'lock', 'shadow'],
  lrc: ['t', 'terminal', 'term', 'inline', 'f', 'floating', 'float', 'desktop', 'off', 'hide', 'disable', 'accent', 'fg', 'next', 'gap', 'size', 'align', 'offset', 'v', 'vertical', 'lock', 'shadow'],

  progress: ['width', 'char', 'chars'],
  bar: ['width', 'char', 'chars'],

  open: ['dir', 'folder'],
  load: ['dir', 'folder'],

  lang: ['en', 'zh', 'ja'],
  language: ['en', 'zh', 'ja'],
  locale: ['en', 'zh', 'ja'],

  mode: ['normal', 'repeat-one', 'repeat-all', 'shuffle'],
  loop: ['normal', 'repeat-one', 'repeat-all', 'shuffle'],
  repeat: ['normal', 'repeat-one', 'repeat-all', 'shuffle'],

  seek: ['step', 'pause'],
  goto: ['step', 'pause'],

  audio: ['mode', 'devices'],
  aud: ['mode', 'devices'],
  'audio mode': ['normal', 'wasapi', 'default', 'w', 'asio', 'exclusive', 'a'],
  'aud mode': ['normal', 'wasapi', 'default', 'w', 'asio', 'exclusive', 'a'],

  listen: ['ui', 'stop'],
  'listen ui': ['default', 'list'],
};
