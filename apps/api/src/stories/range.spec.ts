import { parseRange, UNSATISFIABLE } from './range.js';

describe('parseRange', () => {
  const size = 1000;

  it.each([
    ['bytes=0-99', { start: 0, end: 99 }],
    ['bytes=500-', { start: 500, end: 999 }],
    ['bytes=-100', { start: 900, end: 999 }],
    ['bytes=-5000', { start: 0, end: 999 }],
    ['bytes=990-2000', { start: 990, end: 999 }],
    ['bytes=0-0', { start: 0, end: 0 }],
  ])('%s -> %j', (header, expected) => {
    expect(parseRange(header, size)).toEqual(expected);
  });

  it.each([undefined, '', 'bytes=-', 'items=0-10', 'bytes=0-10,20-30', 'bytes=abc', 'bytes=50-10'])(
    'serves the whole file for %j',
    (header) => {
      expect(parseRange(header, size)).toBeNull();
    },
  );

  it.each(['bytes=1000-', 'bytes=5000-6000', 'bytes=-0'])(
    'rejects %s as unsatisfiable',
    (header) => {
      expect(parseRange(header, size)).toBe(UNSATISFIABLE);
    },
  );
});
