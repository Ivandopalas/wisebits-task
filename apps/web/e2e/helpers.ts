import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

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
export async function signedInUser(browser: Browser, username = uniqueUsername()): Promise<Person> {
  const context = await browser.newContext();
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
