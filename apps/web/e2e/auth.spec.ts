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
