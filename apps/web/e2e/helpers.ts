import {
  expect,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Locator,
  type Page,
} from '@playwright/test';

export const PASSWORD = 'Password123!';

export interface Person {
  username: string;
  email: string;
  context: BrowserContext;
  page: Page;
}

let counter = 0;

/** Unique per run and short enough for the 24-character username limit. */
export function uniqueUsername(prefix = 'e2e'): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${counter}${Math.random().toString(36).slice(2, 5)}`;
}

/**
 * A signed-in user in a browser context of their own. Registration goes through the API with
 * the context's request client, so the session cookies land in that browser.
 */
export async function signedInUser(
  browser: Browser,
  options: BrowserContextOptions = {},
): Promise<Person> {
  const context = await browser.newContext(options);
  const username = uniqueUsername();
  const email = `${username}@example.com`;
  const response = await context.request.post('/api/auth/register', {
    data: { email, username, password: PASSWORD },
  });
  expect(response.status(), await response.text()).toBe(201);
  const page = await context.newPage();
  await page.goto('/chats');
  await expect(page.getByTestId('current-user')).toHaveText(username);
  return { username, email, context, page };
}

/** Opens (or creates) the conversation with `peer` through the People page. */
export async function openConversationWith(person: Person, peer: Person): Promise<void> {
  const { page } = person;
  await page.getByRole('link', { name: 'People', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search by username' }).fill(peer.username);
  const row = page
    .getByTestId('user-list')
    .getByRole('listitem')
    .filter({ hasText: peer.username });
  await row.getByRole('button', { name: 'Message' }).click();
  await expect(page.getByTestId('chat-peer')).toHaveText(peer.username);
}

export async function sendMessage(page: Page, text: string): Promise<void> {
  await page.getByRole('textbox', { name: 'Message' }).fill(text);
  await page.getByRole('textbox', { name: 'Message' }).press('Enter');
}

export function messageList(page: Page) {
  return page.getByTestId('message-list');
}

/** WCAG contrast ratio between an element's text and the background it is drawn on. */
export function contrastRatio(locator: Locator): Promise<number> {
  return locator.evaluate((element) => {
    // Computed colors can stay in oklch (Tailwind's palette); a canvas pixel turns them into sRGB.
    const context = document
      .createElement('canvas')
      .getContext('2d', { willReadFrequently: true })!;
    const luminance = (color: string) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b] = [...context.getImageData(0, 0, 1, 1).data].map((v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    let background = 'rgba(0, 0, 0, 0)';
    for (let node: Element | null = element; node && background === 'rgba(0, 0, 0, 0)';) {
      background = getComputedStyle(node).backgroundColor;
      node = node.parentElement;
    }
    const [light, dark] = [luminance(getComputedStyle(element).color), luminance(background)].sort(
      (a, b) => b - a,
    );
    return (light! + 0.05) / (dark! + 0.05);
  });
}
