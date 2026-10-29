import { expect, test } from '@playwright/test';
import { PASSWORD, signedInUser, uniqueUsername } from './helpers.js';

test('a guest is sent to sign in and, after registering, lands where they were going', async ({
  page,
}) => {
  await page.goto('/users');
  await expect(page).toHaveURL(/\/login\?next=%2Fusers$/);

  await page.getByRole('link', { name: 'Create one' }).click();
  await expect(page).toHaveURL(/\/register\?next=%2Fusers$/);

  const username = uniqueUsername();
  await page.getByLabel('Email').fill(`${username}@example.com`);
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page).toHaveURL(/\/users$/);
  await expect(page.getByTestId('current-user')).toHaveText(username);
});

test('registration explains what is wrong, field by field', async ({ page }) => {
  await page.goto('/register');
  await page.getByLabel('Email').fill('not-an-email');
  await page.getByLabel('Username').fill('a b');
  await page.getByLabel('Password').fill('short');
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page.getByText('Enter a valid email')).toBeVisible();
  await expect(page.getByText('Use only letters, digits, "_" and "."')).toBeVisible();
  await expect(page.getByText('Password must be at least 8 characters')).toBeVisible();
});

test('a taken username is reported on the username field', async ({ browser, page }) => {
  const existing = await signedInUser(browser);
  await page.goto('/register');
  await page.getByLabel('Email').fill(`${uniqueUsername()}@example.com`);
  await page.getByLabel('Username').fill(existing.username.toUpperCase());
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Already taken')).toBeVisible();
  await existing.context.close();
});

test('wrong credentials get one generic answer; right ones sign in', async ({ browser, page }) => {
  const user = await signedInUser(browser);
  await user.context.close();

  await page.goto('/login');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password').fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toHaveText('Invalid email or password');

  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/chats$/);
});

test('a form sent before the scripts load never puts the password in the address', async ({
  browser,
  page,
}) => {
  const user = await signedInUser(browser);
  await user.context.close();

  // A slow network: the server-rendered form is on screen, the app's scripts are not.
  let release!: () => void;
  const scriptsArrive = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/_app/immutable/**/*.js', async (route) => {
    await scriptsArrive;
    await route.continue().catch(() => undefined);
  });

  await page.goto('/register', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Email').fill('early@example.com');
  await page.getByLabel('Username').fill('early_bird');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByLabel('Password').press('Enter');
  await page.waitForTimeout(500);
  expect(new URL(page.url()).search).toBe('');

  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password').fill(PASSWORD);
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeDisabled();
  await page.getByLabel('Password').press('Enter');
  await page.waitForTimeout(500);
  expect(page.url()).not.toContain('password');

  // Once the app is running, what was typed early is still there and signs in.
  release();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/chats$/);
});

test('restoring the session shows a loading screen; an unreachable server says so', async ({
  browser,
}) => {
  const { page, context } = await signedInUser(browser);

  // A slow refresh: the page must not stay blank meanwhile.
  await page.route('**/api/auth/refresh', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await route.continue();
  });
  await page.reload();
  await expect(page.locator('#app-loading')).toBeVisible();
  await expect(page.getByTestId('current-user')).toBeVisible();
  await expect(page.locator('#app-loading')).toHaveCount(0);

  // The API is down and nginx answers for it.
  await page.unroute('**/api/auth/refresh');
  await page.route('**/api/auth/refresh', (route) =>
    route.fulfill({
      status: 502,
      contentType: 'application/json',
      body: JSON.stringify({
        statusCode: 502,
        error: 'Bad Gateway',
        message: 'The server is not available right now. Try again in a moment.',
      }),
    }),
  );
  await page.reload();
  await expect(page.getByRole('heading', { name: 'The server is not reachable' })).toBeVisible();
  await expect(page.getByText('The server is not available right now.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible();

  await context.close();
});

test('the session survives a reload and ends with sign out', async ({ browser }) => {
  const user = await signedInUser(browser);
  const { page } = user;

  await page.reload();
  await expect(page.getByTestId('current-user')).toHaveText(user.username);

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto('/chats');
  await expect(page).toHaveURL(/\/login\?next=%2Fchats$/);
  await user.context.close();
});
