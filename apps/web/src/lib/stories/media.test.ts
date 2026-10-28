import { describe, expect, it } from 'vitest';
import { cameraProblem, pickRecordingType } from './media.js';

describe('pickRecordingType', () => {
  it('prefers VP9 WebM where available (Chrome)', () => {
    expect(pickRecordingType(() => true)).toBe('video/webm;codecs=vp9,opus');
  });

  it('falls back to MP4 where WebM is not recordable (Safari)', () => {
    expect(pickRecordingType((type) => type.startsWith('video/mp4'))).toBe(
      'video/mp4;codecs=avc1,mp4a',
    );
  });

  it('returns null when nothing is supported', () => {
    expect(pickRecordingType(() => false)).toBeNull();
  });
});

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
