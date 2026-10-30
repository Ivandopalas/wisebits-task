import { expect, test } from '@playwright/test';
import { contrastRatio, signedInUser, type Person } from './helpers.js';

/** A WebM signature with nothing playable behind it: the story never ends and moves on. */
const UNPLAYABLE_VIDEO = Buffer.from([
  0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01, 0x42, 0xf2, 0x81,
  0x04, 0x42, 0xf3, 0x81, 0x08, 0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d, 0x42, 0x87, 0x81, 0x04,
  0x42, 0x85, 0x81, 0x02,
]);

async function publishStory(author: Person) {
  const { accessToken } = (await (
    await author.context.request.post('/api/auth/refresh')
  ).json()) as { accessToken: string };
  const response = await author.context.request.post('/api/stories', {
    headers: { Authorization: `Bearer ${accessToken}` },
    multipart: {
      durationMs: '5000',
      video: { name: 'story.webm', mimeType: 'video/webm', buffer: UNPLAYABLE_VIDEO },
    },
  });
  expect(response.status(), await response.text()).toBe(201);
}

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
  await expect(author.page.getByTestId('recording-timer')).toBeVisible();

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

  const feedRequests: string[] = [];
  viewer.page.on('request', (request) => {
    if (request.url().endsWith('/api/stories/feed')) feedRequests.push(request.url());
  });

  await author.page.getByRole('button', { name: 'Share story' }).click();
  await expect(author.page).toHaveURL(/\/chats$/);

  // The story arrives in the event itself: nobody online goes back to the server for the feed.
  const ring = viewer.page.getByTestId('story-author').filter({ hasText: author.username });
  await expect(ring).toHaveAttribute('data-unseen', 'true');
  expect(feedRequests).toEqual([]);

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
  await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();
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

test('the story viewer takes the keyboard and gives it back', async ({ browser }) => {
  const author = await signedInUser(browser);
  const viewer = await signedInUser(browser);
  await publishStory(author);

  const ring = viewer.page.getByTestId('story-author').filter({ hasText: author.username });
  await ring.focus();
  await viewer.page.keyboard.press('Enter');
  const player = viewer.page.getByTestId('story-viewer');
  await expect(player).toBeFocused();
  await expect(player.getByRole('alert')).toBeVisible();

  await viewer.page.keyboard.press('Space');
  await expect(player.getByRole('button', { name: 'Play' })).toBeVisible();

  // On a button Space belongs to the button: this one closes the viewer, it does not resume.
  await player.getByRole('button', { name: 'Close' }).focus();
  await viewer.page.keyboard.press('Space');
  await expect(player).toBeHidden();
  await expect(ring).toBeFocused();

  await author.context.close();
  await viewer.context.close();
});

test('a story stays open and closable when a narrower screen hides the list', async ({
  browser,
}) => {
  const author = await signedInUser(browser);
  const viewer = await signedInUser(browser);
  await publishStory(author);

  await viewer.page.getByRole('link', { name: 'People', exact: true }).click();
  await viewer.page.getByTestId('story-author').filter({ hasText: author.username }).click();
  const player = viewer.page.getByTestId('story-viewer');
  await expect(player).toBeVisible();

  await viewer.page.setViewportSize({ width: 390, height: 800 });
  await expect(player).toBeVisible();
  await player.getByRole('button', { name: 'Close' }).click();
  await expect(player).toBeHidden();

  await author.context.close();
  await viewer.context.close();
});

test('a video that fails gets one new link before the viewer gives up', async ({ browser }) => {
  const author = await signedInUser(browser);
  const viewer = await signedInUser(browser);
  await publishStory(author);
  const links: string[] = [];
  viewer.page.on('request', (request) => {
    if (request.url().endsWith('/playback')) links.push(request.url());
  });

  await viewer.page.getByTestId('story-author').filter({ hasText: author.username }).click();

  await expect(viewer.page.getByTestId('story-viewer').getByRole('alert')).toHaveText(
    'This story could not be played.',
  );
  expect(links).toHaveLength(2);

  await author.context.close();
  await viewer.context.close();
});

test('an empty stories bar is readable and has one tab stop to the recorder', async ({
  browser,
}) => {
  const user = await signedInUser(browser);
  await user.page.route('**/api/stories/feed', (route) => route.fulfill({ json: [] }));
  // Stories published by tests running in parallel would otherwise arrive live and fill the bar.
  await user.page.routeWebSocket(/\/socket\.io\//, (ws) => ws.close());
  await user.page.reload();

  const bar = user.page.getByTestId('stories-bar');
  expect(await contrastRatio(bar.getByText('No stories from others yet'))).toBeGreaterThan(4.5);

  await user.page.getByRole('button', { name: 'Sign out' }).focus();
  await user.page.keyboard.press('Tab');
  await expect(bar.getByTestId('new-story')).toBeFocused();
  await user.page.keyboard.press('Tab');
  await expect(user.page.getByRole('link', { name: 'Chats', exact: true })).toBeFocused();

  await user.context.close();
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
