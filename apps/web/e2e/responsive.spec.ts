import { expect, test, type Page } from '@playwright/test';
import { openConversationWith, signedInUser, type Person } from './helpers.js';

const WIDTHS = [320, 375, 768, 1024, 1440, 1920];

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'page scrolls horizontally').toBeLessThanOrEqual(0);
}

test.describe('layout at every width', () => {
  test.describe.configure({ mode: 'serial' });

  let alice: Person;
  let bob: Person;
  let conversationUrl: string;

  test.beforeAll(async ({ browser }) => {
    alice = await signedInUser(browser);
    bob = await signedInUser(browser);
    await openConversationWith(alice, bob);
    conversationUrl = alice.page.url();
    const { accessToken } = (await (
      await alice.context.request.post('/api/auth/refresh')
    ).json()) as { accessToken: string };
    // The kinds of content that break layouts: an unbroken token and many lines.
    for (const text of [
      'https://example.com/' + 'a-very-long-path-without-spaces-'.repeat(12),
      'line one\nline two\nline three\n' + 'word '.repeat(80),
    ]) {
      await alice.context.request.post(
        `/api/conversations/${conversationUrl.split('/').pop()}/messages`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          data: { text, clientMessageId: crypto.randomUUID() },
        },
      );
    }
  });

  test.afterAll(async () => {
    await alice?.context.close();
    await bob?.context.close();
  });

  for (const width of WIDTHS) {
    test(`${width}px`, async ({ browser }) => {
      const narrow = width < 768;
      const { page } = alice;
      await page.setViewportSize({ width, height: 800 });

      const guest = await browser.newPage({ viewport: { width, height: 800 } });
      for (const path of ['/login', '/register']) {
        await guest.goto(path);
        await expect(
          guest.getByRole('button', { name: /sign in|create account/i }),
        ).toBeInViewport();
        await expectNoHorizontalScroll(guest);
      }
      await guest.close();

      await page.goto('/chats');
      await expect(page.getByTestId('conversation-list')).toBeVisible();
      await expectNoHorizontalScroll(page);

      await page.goto(conversationUrl);
      await expect(page.getByTestId('message-list')).toContainText('a-very-long-path');
      await expect(page.getByRole('textbox', { name: 'Message' })).toBeInViewport();
      await expect(page.getByRole('button', { name: 'Send' })).toBeInViewport();
      // Narrow screens show the conversation alone; wide ones keep the list beside it.
      await expect(page.getByTestId('conversation-list')).toBeVisible({ visible: !narrow });
      await expectNoHorizontalScroll(page);
      const bubbleOverflow = await page
        .getByTestId('message')
        .evaluateAll((items) => items.some((li) => li.scrollWidth > li.clientWidth + 1));
      expect(bubbleOverflow, 'a message bubble overflows').toBe(false);

      await page.goto('/users');
      await expect(page.getByRole('searchbox', { name: 'Search by username' })).toBeInViewport();
      await expectNoHorizontalScroll(page);

      await page.goto('/stories/new');
      await expect(page.getByTestId('recorder')).toBeInViewport();
      await expectNoHorizontalScroll(page);
    });
  }
});
