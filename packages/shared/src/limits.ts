export const LIMITS = {
  usernameMin: 3,
  usernameMax: 24,
  passwordMin: 8,
  passwordMax: 128,
  emailMax: 254,
  messageMaxLength: 4000,
  pageSizeDefault: 30,
  pageSizeMax: 100,
  presenceQueryMax: 200,
  storyMaxDurationMs: 15_000,
  storyMaxBytes: 25 * 1024 * 1024,
  storyTtlMs: 24 * 60 * 60 * 1000,
} as const;

export const STORY_MIME_TYPES = ['video/webm', 'video/mp4'] as const;
export type StoryMimeType = (typeof STORY_MIME_TYPES)[number];

/** MediaRecorder stops on a timer, so the real length overshoots by a few frames. */
export const STORY_DURATION_TOLERANCE_MS = 500;
