// Command argument completions: key is the space-separated command chain (lowercase),
// value is the array of valid next words.
export const subCompletions: Record<string, string[]> = {
  sync: ['pl', 'playlist', 'theme'],
  'sync pl': ['export', 'import'],
  'sync playlist': ['export', 'import'],
  'sync theme': ['save', 'load', 'apply', 'switch', 'list', 'ls', 'delete', 'rm', 'del', 'export', 'import'],

  pl: ['create', 'new', 'list', 'ls', 'delete', 'rm', 'del', 'edit', 'info'],

  set: ['vol', 'volume', 'color', 'colors', 'bg', 'background', 'blur', 'font', 'maxlines'],

  track: ['info', 'pl', 'edit', 'delete', 'move', 'copy', 'tag'],
  t: ['info', 'pl', 'edit', 'delete', 'move', 'copy', 'tag'],
  'track pl': ['delete', 'move', 'copy'],
  't pl': ['delete', 'move', 'copy'],
  'track tag': ['add', 'rm', 'list', 'auto'],
  't tag': ['add', 'rm', 'list', 'auto'],

  server: ['add', 'list', 'rm', 'connect', 'disconnect', 'status', 'search', 'play', 'get', 'download', 'autoadd', 'aa'],
  srv: ['add', 'list', 'rm', 'connect', 'disconnect', 'status', 'search', 'play', 'get', 'download', 'autoadd', 'aa'],
  'server autoadd': ['on', 'off'],
  'server aa': ['on', 'off'],
  'srv autoadd': ['on', 'off'],
  'srv aa': ['on', 'off'],

  llm: ['url', 'key', 'model', 'audio', 'status'],
  'llm audio': ['on', 'off'],

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

  focuskey: ['off'],
  fk: ['off'],
};
