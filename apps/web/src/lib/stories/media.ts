/**
 * Recording formats in order of preference. Chrome and Firefox record WebM; Safari only MP4,
 * which is why the API accepts both.
 */
export const RECORDING_TYPES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4;codecs=avc1,mp4a',
  'video/mp4',
] as const;

export function pickRecordingType(isSupported: (type: string) => boolean): string | null {
  return RECORDING_TYPES.find((type) => isSupported(type)) ?? null;
}

export type CameraProblem = 'unsupported' | 'denied' | 'missing' | 'busy' | 'insecure' | 'unknown';

export const CAMERA_PROBLEM_TEXT: Record<CameraProblem, string> = {
  unsupported: 'This browser cannot record video. Try a recent Chrome, Firefox or Safari.',
  insecure: 'The camera only works over HTTPS or on localhost.',
  denied: 'Camera access was blocked. Allow it in the browser’s site settings and try again.',
  missing: 'No camera was found. Connect one and try again.',
  busy: 'The camera is being used by another application.',
  unknown: 'Could not start the camera.',
};

export function cameraProblem(error: unknown): CameraProblem {
  const name = error instanceof DOMException || error instanceof Error ? error.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'denied';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'missing';
    case 'NotReadableError':
    case 'AbortError':
      return 'busy';
    case 'InsecureContext':
      return 'insecure';
    default:
      return 'unknown';
  }
}

/**
 * Asks for camera and microphone; without a microphone a silent video is still fine, so a
 * missing mic falls back to video only.
 */
export async function openCamera(): Promise<MediaStream> {
  if (!window.isSecureContext) {
    throw Object.assign(new Error('insecure'), { name: 'InsecureContext' });
  }
  const video: MediaTrackConstraints = {
    facingMode: 'user',
    width: { ideal: 720 },
    height: { ideal: 1280 },
    frameRate: { ideal: 30 },
  };
  try {
    return await navigator.mediaDevices.getUserMedia({ video, audio: true });
  } catch (error) {
    if (cameraProblem(error) === 'missing') {
      return navigator.mediaDevices.getUserMedia({ video });
    }
    throw error;
  }
}

export function stopStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((track) => track.stop());
}

export function recordingSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== 'undefined'
  );
}
