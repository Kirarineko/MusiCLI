// @vitest-environment happy-dom

import { describe, it, expect } from 'vitest';
import { formatTime, escapeHtml, getFileName } from '../format';

describe('formatTime', () => {
  it('formats zero seconds', () => {
    expect(formatTime(0)).toBe('00:00');
  });

  it('formats full seconds', () => {
    expect(formatTime(5)).toBe('00:05');
    expect(formatTime(59)).toBe('00:59');
  });

  it('formats minutes and seconds', () => {
    expect(formatTime(65)).toBe('01:05');
    expect(formatTime(3661)).toBe('61:01');
  });

  it('handles NaN', () => {
    expect(formatTime(NaN)).toBe('--:--');
  });

  it('pads single-digit minutes and seconds', () => {
    expect(formatTime(61)).toBe('01:01');
    expect(formatTime(600)).toBe('10:00');
  });
});

describe('escapeHtml', () => {
  it('escapes angle brackets', () => {
    expect(escapeHtml('<script>alert("xss")</script>'))
      .toBe('&lt;script&gt;alert("xss")&lt;/script&gt;');
  });

  it('escapes ampersands', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('returns plain text unchanged', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });

  it('handles empty string', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('does not escape quotes (safe in text content)', () => {
    expect(escapeHtml('say "hello"')).toBe('say "hello"');
  });
});

describe('getFileName', () => {
  it('extracts file name from unix path', () => {
    expect(getFileName('/home/user/music/song.mp3')).toBe('song.mp3');
  });

  it('extracts file name from windows path', () => {
    expect(getFileName('C:\\Users\\music\\song.mp3')).toBe('song.mp3');
  });

  it('returns input when no path separators', () => {
    expect(getFileName('song.mp3')).toBe('song.mp3');
  });

  it('handles empty string', () => {
    expect(getFileName('')).toBe('');
  });
});
