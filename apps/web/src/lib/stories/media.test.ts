import { describe, expect, it } from 'vitest';
import { cameraProblem } from './media.js';

describe('cameraProblem', () => {
  it.each([
    ['NotAllowedError', 'denied'],
    ['NotFoundError', 'missing'],
    ['NotReadableError', 'busy'],
    ['TypeError', 'unknown'],
  ])('maps %s to %s', (name, expected) => {
    expect(cameraProblem(new DOMException('x', name))).toBe(expected);
  });
});
