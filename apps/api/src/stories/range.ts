import type { ByteRange } from '../storage/video-storage.js';

export const UNSATISFIABLE = 'unsatisfiable';

/**
 * Parses a single-range `Range` header (RFC 9110). Returns null when the whole file should be
 * sent: no header, a header we choose to ignore (multiple ranges) or malformed syntax.
 */
export function parseRange(
  header: string | undefined,
  size: number,
): ByteRange | typeof UNSATISFIABLE | null {
  if (!header) {
    return null;
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === '' && match[2] === '')) {
    return null;
  }
  const [, from, to] = match;

  if (from === '') {
    // Suffix range: the last N bytes.
    const length = Number(to);
    if (length === 0 || size === 0) {
      return UNSATISFIABLE;
    }
    return { start: Math.max(size - length, 0), end: size - 1 };
  }

  const start = Number(from);
  if (to !== '' && Number(to) < start) {
    return null; // an invalid range-spec is ignored, not rejected
  }
  if (start >= size) {
    return UNSATISFIABLE;
  }
  return { start, end: to === '' ? size - 1 : Math.min(Number(to), size - 1) };
}
