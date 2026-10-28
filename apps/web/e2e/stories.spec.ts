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

  await author.context.close();
  await viewer.context.close();
});
