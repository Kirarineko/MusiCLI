import { describe, it, expect } from 'vitest';
import { hasError } from '../guards';

describe('hasError', () => {
  it('returns true for objects with error string', () => {
    expect(hasError({ error: 'fail' })).toBe(true);
    expect(hasError({ error: '' })).toBe(true);
  });

  it('returns false for success objects', () => {
    expect(hasError({ data: 'ok' })).toBe(false);
    expect(hasError({})).toBe(false);
  });

  it('returns false for non-objects', () => {
    expect(hasError(null)).toBe(false);
    expect(hasError('string')).toBe(false);
    expect(hasError(42)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(hasError(undefined)).toBe(false);
  });

  it('returns false for arrays', () => {
    expect(hasError([1, 2, 3])).toBe(false);
  });

  it('returns true for objects with additional properties', () => {
    expect(hasError({ error: 'fail', code: 500 })).toBe(true);
  });
});
