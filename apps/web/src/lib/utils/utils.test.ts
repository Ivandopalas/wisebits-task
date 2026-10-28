import { describe, expect, it } from 'vitest';
import { daysBetween, formatDayLabel, groupByDay } from './format.js';
import { safeNext } from './redirect.js';
import { uuid } from './uuid.js';

describe('groupByDay', () => {
  it('splits a chronological list into calendar days', () => {
    const at = (day: number, hour: number) => ({
      createdAt: new Date(2026, 9, day, hour).toISOString(),
    });
    const groups = groupByDay([at(27, 23), at(28, 0), at(28, 13), at(30, 9)]);
    expect(groups.map((g) => g.items.length)).toEqual([1, 2, 1]);
  });
});

describe('formatDayLabel', () => {
  const now = new Date(2026, 9, 28, 15);

  it('names today and yesterday', () => {
    expect(formatDayLabel(new Date(2026, 9, 28, 1).toISOString(), now)).toBe('Today');
    expect(formatDayLabel(new Date(2026, 9, 27, 23).toISOString(), now)).toBe('Yesterday');
  });

  it('counts calendar days, not 24-hour periods', () => {
    expect(daysBetween(new Date(2026, 9, 27, 23, 59), new Date(2026, 9, 28, 0, 1))).toBe(1);
  });
});

describe('safeNext', () => {
  it.each([
    ['/chats/42', '/chats/42'],
    ['/users?q=a', '/users?q=a'],
    [null, '/chats'],
    ['https://evil.example', '/chats'],
    ['//evil.example', '/chats'],
    ['/\\evil.example', '/chats'],
  ])('%j -> %j', (input, expected) => {
    expect(safeNext(input)).toBe(expected);
  });
});

describe('uuid', () => {
  it('produces RFC 4122 v4 ids', () => {
    expect(uuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
