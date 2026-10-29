import { expect, test } from '@playwright/test';
import { signedInUser } from './helpers.js';

test('a story is recorded from the camera, stops itself at 15 s and reaches others live', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const author = await signedInUser(browser);
  const viewer = await signedInUser(browser);

  await author.page.getByTestId('new-story').click();
  const recorder = author.page.getByTestId('recorder');
  await expect(recorder).toHaveAttribute('data-phase', 'ready');

  await author.page.getByRole('button', { name: 'Record' }).click();
  await expect(author.page.getByTestId('countdown')).toBeVisible();
  await expect(author.page.getByTestId('recording-timer')).toBeVisible({ timeout: 5_000 });

  // Nobody presses Stop: the recorder must end on its own at the 15 second limit.
  const startedAt = Date.now();
  await expect(recorder).toHaveAttribute('data-phase', 'review', { timeout: 25_000 });
  expect(Date.now() - startedAt).toBeGreaterThan(13_000);

  // The WebM duration fix: the recorded file reports a real length, not Infinity.
  const preview = author.page.getByTestId('recorded-preview');
  await expect
    .poll(() => preview.evaluate((video: HTMLVideoElement) => video.duration), { timeout: 10_000 })
    .toBeGreaterThan(14);
  const duration = await preview.evaluate((video: HTMLVideoElement) => video.duration);
  expect(Number.isFinite(duration)).toBe(true);
  expect(duration).toBeLessThanOrEqual(15.5);

  await author.page.getByRole('button', { name: 'Share story' }).click();
  await expect(author.page).toHaveURL(/\/chats$/);

  // The viewer's feed updates over the socket.
  const ring = viewer.page.getByTestId('story-author').filter({ hasText: author.username });
  await expect(ring).toHaveAttribute('data-unseen', 'true');

  await ring.click();
  const player = viewer.page.getByTestId('story-viewer');
  await expect(player).toBeVisible();
  await expect
    .poll(() =>
      viewer.page
        .getByTestId('story-video')
        .evaluate((video: HTMLVideoElement) => video.currentTime),
    )
    .toBeGreaterThan(0.5);

  await viewer.page.keyboard.press('Escape');
  await expect(player).toBeHidden();
  await expect(ring).toHaveAttribute('data-unseen', 'false');

  // The author deletes it, but only after confirming; it disappears for the viewer live.
  await author.page.getByRole('button', { name: 'View your story' }).click();
  const ownPlayer = author.page.getByTestId('story-viewer');
  await ownPlayer.getByRole('button', { name: 'Delete' }).click();
  const confirm = author.page.getByRole('alertdialog', { name: 'Delete this story?' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toBeHidden();
  await expect(ownPlayer).toBeVisible();

  await ownPlayer.getByRole('button', { name: 'Delete' }).click();
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await expect(ownPlayer).toBeHidden();
  await expect(ring).toHaveCount(0);

  await author.context.close();
  await viewer.context.close();
});

test('leaving while the camera is still starting turns it off', async ({ browser }) => {
  const user = await signedInUser(browser);
  // A slow start, as when the permission prompt stays open; every stream is kept for inspection.
  await user.page.addInitScript(() => {
    const devices = navigator.mediaDevices;
    const original = devices.getUserMedia.bind(devices);
    const opened: MediaStream[] = [];
    Object.assign(window, { openedStreams: opened });
    devices.getUserMedia = async (constraints) => {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      const stream = await original(constraints);
      opened.push(stream);
      return stream;
    };
  });
  await user.page.reload();

  await user.page.getByTestId('new-story').click();
  await expect(user.page.getByTestId('recorder')).toHaveAttribute('data-phase', 'starting');
  await user.page.waitForTimeout(400);
  await user.page.getByRole('link', { name: 'Close' }).click();
  await expect(user.page).toHaveURL(/\/chats$/);

  const liveTracks = () =>
    user.page.evaluate(() => {
      const opened = (window as unknown as { openedStreams: MediaStream[] }).openedStreams;
      const live = opened.flatMap((s) => s.getTracks()).filter((t) => t.readyState === 'live');
      return opened.length === 0 ? null : live.length;
    });
  await expect.poll(liveTracks, { timeout: 10_000 }).toBe(0);
  await user.page.waitForTimeout(500);
  expect(await liveTracks()).toBe(0);

  await user.context.close();
});
