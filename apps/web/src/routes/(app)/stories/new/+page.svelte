<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { LIMITS } from '@chat/shared';
  import fixWebmDuration from 'fix-webm-duration';
  import { untrack } from 'svelte';
  import { errorMessage } from '#lib/api/http.js';
  import {
    CAMERA_PROBLEM_TEXT,
    cameraProblem,
    openCamera,
    pickRecordingType,
    recordingSupported,
    stopStream,
    type CameraProblem,
  } from '#lib/stories/media.js';
  import { uploadStory } from '#lib/stores/stories.js';

  type Phase = 'starting' | 'ready' | 'countdown' | 'recording' | 'review' | 'uploading' | 'error';

  const MAX_MS = LIMITS.storyMaxDurationMs;
  const COUNTDOWN_FROM = 3;

  let phase = $state<Phase>('starting');
  let problem = $state<CameraProblem>('unknown');
  let stream = $state<MediaStream | null>(null);
  let countdown = $state(COUNTDOWN_FROM);
  let elapsedMs = $state(0);
  let recorded = $state<{ blob: Blob; url: string; durationMs: number } | null>(null);
  let uploadProgress = $state(0);
  let uploadError = $state<string | null>(null);
  let live = $state<HTMLVideoElement>();

  let recorder: MediaRecorder | null = null;
  let timers: Array<ReturnType<typeof setTimeout>> = [];
  let ticker: ReturnType<typeof setInterval> | undefined;
  let disposed = false;
  let cameraRequest = 0;

  const seconds = (ms: number) => `0:${String(Math.floor(ms / 1000)).padStart(2, '0')}`;

  function clearTimers() {
    timers.forEach((t) => clearTimeout(t));
    timers = [];
    clearInterval(ticker);
  }

  async function startCamera() {
    const request = ++cameraRequest;
    phase = 'starting';
    if (!recordingSupported()) {
      problem = 'unsupported';
      phase = 'error';
      return;
    }
    try {
      const opened = await openCamera();
      // The permission prompt can stay open for a while: by the time the camera starts, the
      // user may have left the page or asked again. Nobody owns this stream then.
      if (disposed || request !== cameraRequest) {
        stopStream(opened);
        return;
      }
      stream = opened;
      phase = 'ready';
    } catch (error) {
      if (disposed || request !== cameraRequest) return;
      problem = cameraProblem(error);
      phase = 'error';
    }
  }

  function startCountdown() {
    phase = 'countdown';
    countdown = COUNTDOWN_FROM;
    for (let i = 1; i <= COUNTDOWN_FROM; i += 1) {
      timers.push(
        setTimeout(() => {
          countdown = COUNTDOWN_FROM - i;
          if (countdown === 0) startRecording();
        }, i * 1000),
      );
    }
  }

  function startRecording() {
    if (!stream) return;
    const mimeType = pickRecordingType((type) => MediaRecorder.isTypeSupported(type));
    const chunks: Blob[] = [];
    let startedAt = 0;
    const instance = new MediaRecorder(
      stream,
      mimeType ? { mimeType, videoBitsPerSecond: 2_500_000 } : undefined,
    );
    recorder = instance;

    instance.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    instance.onstart = () => {
      startedAt = performance.now();
      elapsedMs = 0;
      phase = 'recording';
      ticker = setInterval(
        () => (elapsedMs = Math.min(performance.now() - startedAt, MAX_MS)),
        100,
      );
      // The hard limit: the recorder stops itself, the user cannot overshoot.
      timers.push(setTimeout(stopRecording, MAX_MS));
    };
    instance.onstop = async () => {
      clearTimers();
      const durationMs = Math.min(performance.now() - startedAt, MAX_MS);
      // Done with the camera: turn it off before the review, not when the page closes.
      stopStream(stream);
      stream = null;
      const type = (instance.mimeType || mimeType || 'video/webm').split(';')[0]!;
      let blob = new Blob(chunks, { type });
      if (type === 'video/webm') {
        // Chrome writes WebM without a duration, which breaks seeking and progress in players.
        blob = await fixWebmDuration(blob, durationMs, { logger: false });
      }
      recorded = { blob, url: URL.createObjectURL(blob), durationMs };
      phase = 'review';
    };
    instance.start(250);
  }

  function stopRecording() {
    if (recorder?.state === 'recording') recorder.stop();
  }

  function discardRecording() {
    if (recorded) URL.revokeObjectURL(recorded.url);
    recorded = null;
  }

  async function retake() {
    discardRecording();
    uploadError = null;
    await startCamera();
  }

  async function publish() {
    if (!recorded) return;
    phase = 'uploading';
    uploadProgress = 0;
    uploadError = null;
    try {
      await uploadStory(recorded.blob, recorded.durationMs, (p) => (uploadProgress = p));
      await goto(resolve('/(app)/chats'));
    } catch (error) {
      uploadError = errorMessage(error);
      phase = 'review';
    }
  }

  $effect(() => {
    if (live && stream) live.srcObject = stream;
  });

  $effect(() => {
    untrack(() => void startCamera());
    return () => {
      disposed = true;
      clearTimers();
      if (recorder?.state === 'recording') {
        recorder.onstop = null;
        recorder.stop();
      }
      stopStream(stream);
      discardRecording();
    };
  });
</script>

<svelte:head>
  <title>New story · Realtime Chat</title>
</svelte:head>

<header class="flex items-center gap-3 border-b border-gray-200 px-4 py-3">
  <a
    href={resolve('/(app)/chats')}
    class="rounded-lg p-1 text-gray-600 hover:bg-gray-100"
    aria-label="Close"
  >
    <svg class="size-5" viewBox="0 0 20 20" fill="currentColor"
      ><path
        d="M4.3 4.3a1 1 0 0 1 1.4 0L10 8.6l4.3-4.3a1 1 0 1 1 1.4 1.4L11.4 10l4.3 4.3a1 1 0 0 1-1.4 1.4L10 11.4l-4.3 4.3a1 1 0 0 1-1.4-1.4L8.6 10 4.3 5.7a1 1 0 0 1 0-1.4z"
      /></svg
    >
  </a>
  <h1 class="font-semibold text-gray-900">New story</h1>
  <span class="ml-auto text-xs text-gray-500">Up to {MAX_MS / 1000} seconds</span>
</header>

<div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 bg-gray-900 p-4">
  <div
    class="relative aspect-[9/16] h-full max-h-[70vh] max-w-full overflow-hidden rounded-2xl bg-black"
    data-testid="recorder"
    data-phase={phase}
  >
    {#if phase === 'error'}
      <div class="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
        <p class="text-sm text-gray-200" role="alert">{CAMERA_PROBLEM_TEXT[problem]}</p>
        {#if problem !== 'unsupported' && problem !== 'insecure'}
          <button
            type="button"
            class="rounded-lg bg-white px-4 py-2 text-sm font-medium text-gray-900"
            onclick={startCamera}
          >
            Try again
          </button>
        {/if}
      </div>
    {:else if recorded && (phase === 'review' || phase === 'uploading')}
      <!-- svelte-ignore a11y_media_has_caption (the user's own fresh recording has no captions) -->
      <video
        src={recorded.url}
        class="h-full w-full object-cover"
        controls
        playsinline
        loop
        autoplay
        data-testid="recorded-preview"
      ></video>
    {:else}
      <!-- Mirrored like a mirror: what people expect from a front camera preview. -->
      <video
        bind:this={live}
        class="h-full w-full -scale-x-100 object-cover"
        autoplay
        muted
        playsinline
      ></video>
      {#if phase === 'starting'}
        <p class="absolute inset-0 flex items-center justify-center text-sm text-gray-300">
          Starting camera…
        </p>
      {/if}
      {#if phase === 'countdown'}
        <span
          class="absolute inset-0 flex items-center justify-center text-7xl font-bold text-white drop-shadow"
          data-testid="countdown">{countdown}</span
        >
      {/if}
      {#if phase === 'recording'}
        <div class="absolute inset-x-3 top-3 h-1 overflow-hidden rounded-full bg-white/30">
          <div class="h-full bg-red-500" style:width="{(elapsedMs / MAX_MS) * 100}%"></div>
        </div>
        <span
          class="absolute top-6 left-3 flex items-center gap-1.5 rounded-full bg-black/50 px-2 py-0.5 text-xs font-medium text-white"
          data-testid="recording-timer"
        >
          <span class="size-2 animate-pulse rounded-full bg-red-500"></span>
          {seconds(elapsedMs)} / {seconds(MAX_MS)}
        </span>
      {/if}
    {/if}
  </div>

  <div class="flex min-h-12 items-center gap-3">
    {#if phase === 'ready'}
      <button
        type="button"
        class="rounded-full bg-red-600 px-6 py-3 text-sm font-semibold text-white hover:bg-red-500"
        onclick={startCountdown}
      >
        Record
      </button>
    {:else if phase === 'recording'}
      <button
        type="button"
        class="rounded-full bg-white px-6 py-3 text-sm font-semibold text-gray-900"
        onclick={stopRecording}
      >
        Stop
      </button>
    {:else if phase === 'review'}
      <button
        type="button"
        class="rounded-full border border-white/40 px-5 py-2.5 text-sm font-medium text-white hover:bg-white/10"
        onclick={retake}
      >
        Retake
      </button>
      <button
        type="button"
        class="rounded-full bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500"
        onclick={publish}
      >
        Share story
      </button>
    {:else if phase === 'uploading'}
      <div class="flex w-56 flex-col items-center gap-2" role="status">
        <div class="h-1.5 w-full overflow-hidden rounded-full bg-white/20">
          <div class="h-full bg-indigo-400" style:width="{Math.round(uploadProgress * 100)}%"></div>
        </div>
        <span class="text-xs text-gray-300">Uploading… {Math.round(uploadProgress * 100)}%</span>
      </div>
    {/if}
  </div>

  {#if uploadError}
    <p class="text-sm text-red-300" role="alert">{uploadError}</p>
  {/if}
</div>
