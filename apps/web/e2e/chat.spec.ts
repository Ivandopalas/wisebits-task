import { expect, test, type WebSocketRoute } from '@playwright/test';
import {
  contrastRatio,
  messageList,
  openConversationWith,
  sendMessage,
  signedInUser,
} from './helpers.js';

test('two people chat in real time, both ways, without reloading', async ({ browser }) => {
  const alice = await signedInUser(browser);
  const bob = await signedInUser(browser);

  await openConversationWith(alice, bob);
  await expect(alice.page.getByTestId('chat-status')).toHaveText('online');
  await sendMessage(alice.page, 'Hi Bob, are you there?');
  await expect(messageList(alice.page).getByTestId('message').last()).toHaveAttribute(
    'data-status',
    'sent',
  );

  // Bob never reloads: the conversation and its unread badge arrive over the socket.
  const conversation = bob.page
    .getByTestId('conversation-item')
    .filter({ hasText: alice.username });
  await expect(conversation).toContainText('Hi Bob, are you there?');
  await expect(conversation.getByTestId('unread-badge')).toHaveText('1');

  await conversation.click();
  await expect(messageList(bob.page)).toContainText('Hi Bob, are you there?');
  await expect(conversation.getByTestId('unread-badge')).toHaveCount(0);
  // The open conversation is highlighted, and its secondary text stays readable on that.
  expect(await contrastRatio(conversation.locator('time'))).toBeGreaterThan(4.5);
  expect(await contrastRatio(conversation.getByText('Hi Bob, are you there?'))).toBeGreaterThan(
    4.5,
  );
  // Alice sees that Bob has read it.
  await expect(messageList(alice.page).getByTestId('message-read')).toHaveCount(1);

  // Typing indicator, then the reply. Bob types for about 9 s, longer than the indicator lives
  // without a refresh, and Alice must see "typing…" the whole time.
  const status = alice.page.getByTestId('chat-status');
  let typed = false;
  const typing = bob.page
    .getByRole('textbox', { name: 'Message' })
    .pressSequentially('Yes! Typing this slowly', { delay: 400 })
    .then(() => (typed = true));
  await expect(status).toHaveText('typing…');
  const samples: string[] = [];
  while (!typed) {
    samples.push(await status.innerText());
    await alice.page.waitForTimeout(250);
  }
  await typing;
  expect(samples.length).toBeGreaterThan(20);
  expect(samples.filter((s) => s !== 'typing…')).toEqual([]);
  await bob.page.getByRole('textbox', { name: 'Message' }).press('Enter');
  await expect(messageList(alice.page)).toContainText('Yes! Typing this slowly');
  await expect(status).toHaveText('online');

  // Bob's other tab gets his own message too.
  const bobSecondTab = await bob.context.newPage();
  await bobSecondTab.goto(bob.page.url());
  await expect(messageList(bobSecondTab)).toContainText('Yes!');
  await sendMessage(alice.page, 'Both your tabs should see this');
  await expect(messageList(bobSecondTab)).toContainText('Both your tabs should see this');
  await expect(messageList(bob.page)).toContainText('Both your tabs should see this');

  await alice.context.close();
  await bob.context.close();
});

test('a lost network shows at once and recovers: missed messages arrive, queued ones go out', async ({
  browser,
}) => {
  const alice = await signedInUser(browser);
  const bob = await signedInUser(browser);

  // Lets one send hang, to catch it on its way when the network goes.
  let holdSends = false;
  await alice.page.routeWebSocket(/\/socket\.io\//, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((frame) => {
      if (!holdSends || !String(frame).includes('message:send')) server.send(frame);
    });
  });
  await alice.page.reload();

  await openConversationWith(alice, bob);
  await sendMessage(alice.page, 'before the outage');
  await openConversationWith(bob, alice);
  await expect(messageList(bob.page)).toContainText('before the outage');
  const status = alice.page.getByTestId('chat-status');
  await expect(status).toHaveText('online');

  holdSends = true;
  await sendMessage(alice.page, 'on its way when the network went');
  const onItsWay = messageList(alice.page)
    .getByTestId('message')
    .filter({ hasText: 'on its way when the network went' });
  await expect(onItsWay).toHaveAttribute('data-status', 'sending');

  // Long before the ping timeout, which is the only other way to find out.
  await alice.context.setOffline(true);
  await expect(onItsWay).toHaveAttribute('data-status', 'failed', { timeout: 1000 });
  await expect(alice.page.getByTestId('connection-banner')).toBeVisible({ timeout: 5000 });

  // Alice can say nothing about Bob now: he is not "offline", she is.
  await expect(status).toHaveText('connecting…');
  await expect(alice.page.getByTitle('Online')).toHaveCount(0);

  await sendMessage(bob.page, 'sent while Alice was offline');
  await sendMessage(alice.page, 'typed while offline');
  const queued = messageList(alice.page)
    .getByTestId('message')
    .filter({ hasText: 'typed while offline' });

  // It cannot go anywhere: the bubble says so right away, stays readable and offers a retry.
  await expect(queued).toHaveAttribute('data-status', 'failed', { timeout: 1000 });
  const retry = queued.getByRole('button', { name: 'Retry' });
  await expect(retry).toBeVisible();
  expect(await contrastRatio(queued.getByText('typed while offline'))).toBeGreaterThan(4.5);
  expect(await contrastRatio(retry)).toBeGreaterThan(4.5);

  holdSends = false;
  await alice.context.setOffline(false);
  await expect(alice.page.getByTestId('connection-banner')).toBeHidden({ timeout: 20_000 });
  await expect(status).toHaveText('online');
  await expect(messageList(alice.page)).toContainText('sent while Alice was offline');
  await expect(queued).toHaveAttribute('data-status', 'sent', { timeout: 20_000 });
  await expect(onItsWay).toHaveAttribute('data-status', 'sent');
  // Delivered exactly once despite the retries.
  await expect(messageList(bob.page).getByText('typed while offline')).toHaveCount(1);
  await expect(messageList(bob.page).getByText('on its way when the network went')).toHaveCount(1);

  await alice.context.close();
  await bob.context.close();
});

test('a conversation the peer opened survives a reload and a reconnect', async ({ browser }) => {
  const alice = await signedInUser(browser);
  const bob = await signedInUser(browser);
  const liveSockets: WebSocketRoute[] = [];
  await bob.page.routeWebSocket(/\/socket\.io\//, (ws) => {
    ws.connectToServer();
    liveSockets.push(ws);
  });

  // Alice opens it and writes nothing; Bob opens the same conversation from People.
  await openConversationWith(alice, bob);
  await openConversationWith(bob, alice);

  await bob.page.reload();
  await expect(bob.page.getByTestId('chat-peer')).toHaveText(alice.username);
  await expect(bob.page.getByTestId('chat-status')).toHaveText('online');

  // After a reconnect the app reloads the conversation list; the open one must not drop out.
  const listReloaded = bob.page.waitForResponse(
    (r) => r.request().method() === 'GET' && new URL(r.url()).pathname === '/api/conversations',
  );
  await Promise.all(liveSockets.splice(0).map((ws) => ws.close()));
  await listReloaded;
  await expect(bob.page.getByTestId('chat-peer')).toHaveText(alice.username);
  await expect(
    bob.page.getByTestId('conversation-item').filter({ hasText: alice.username }),
  ).toBeVisible();

  await alice.context.close();
  await bob.context.close();
});

test('on a phone Enter starts a new line and the button sends', async ({
  browser,
  browserName,
}) => {
  test.skip(browserName === 'firefox', 'Playwright emulates touch screens in Chromium only');
  const alice = await signedInUser(browser, devices['Pixel 7']);
  const bob = await signedInUser(browser);
  await openConversationWith(alice, bob);

  const composer = alice.page.getByRole('textbox', { name: 'Message' });
  await composer.fill('first line');
  await composer.press('Enter');
  await composer.pressSequentially('second line');
  await expect(composer).toHaveValue('first line\nsecond line');
  await expect(messageList(alice.page).getByTestId('message')).toHaveCount(0);

  await alice.page.getByRole('button', { name: 'Send' }).tap();
  await expect(messageList(alice.page).getByTestId('message')).toContainText(
    'first line\nsecond line',
  );
  await expect(composer).toHaveValue('');

  await alice.context.close();
  await bob.context.close();
});

test('a broken conversation link and an overlong search are no dead ends', async ({ browser }) => {
  const { page, context } = await signedInUser(browser);
  // On a phone the conversation list is hidden behind the open conversation.
  await page.setViewportSize({ width: 375, height: 800 });
  for (const id of ['zzz', '6720f0c0a1b2c3d4e5f60718']) {
    await page.goto(`/chats/${id}`);
    await expect(page.getByRole('alert')).toHaveText('Conversation not found.');
  }
  await page.getByRole('link', { name: 'Back to chats' }).click();
  await expect(page).toHaveURL(/\/chats$/);

  await page.getByRole('link', { name: 'People', exact: true }).click();
  const search = page.getByRole('searchbox', { name: 'Search by username' });
  await search.pressSequentially('x'.repeat(30));
  await expect(search).toHaveValue('x'.repeat(24));
  await expect(page.getByText(`Nobody found for “${'x'.repeat(24)}”.`)).toBeVisible();

  await context.close();
});

test('history loads older messages when scrolling up', async ({ browser }) => {
  const alice = await signedInUser(browser);
  const bob = await signedInUser(browser);
  await openConversationWith(alice, bob);
  const conversationId = alice.page.url().split('/').pop()!;

  // Seed a long history quickly over REST; the page should still show only the latest page.
  const refreshed = await alice.context.request.post('/api/auth/refresh');
  const { accessToken: token } = (await refreshed.json()) as { accessToken: string };
  for (let i = 1; i <= 45; i += 1) {
    const res = await alice.context.request.post(`/api/conversations/${conversationId}/messages`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { text: `history ${i}`, clientMessageId: crypto.randomUUID() },
    });
    expect(res.status()).toBe(201);
  }

  await openConversationWith(bob, alice);
  const list = messageList(bob.page);
  await expect(list).toContainText('history 45');
  await expect(list.getByText('history 1', { exact: true })).toHaveCount(0);

  await list.evaluate((el) => (el.scrollTop = 0));
  await expect(list.getByText('history 1', { exact: true })).toBeVisible();
  const beginning = list.getByText('This is the beginning of the conversation');
  await expect(beginning).toBeVisible();
  expect(await contrastRatio(beginning)).toBeGreaterThan(4.5);

  // A screen reader hears what is new, and none of the history loaded above.
  const announced = bob.page.getByTestId('new-message');
  await expect(announced).toBeEmpty();

  // Reading old messages, Bob is not yanked to the bottom by a new one; a button offers to jump.
  await sendMessage(alice.page, 'a fresh one');
  await sendMessage(alice.page, 'and one more');
  const jump = bob.page.getByTestId('jump-to-latest');
  await expect(list).toContainText('and one more');
  await expect(announced).toHaveText(`${alice.username}: and one more`);
  await expect(jump.locator('span').first()).toHaveText('2');
  await expect(list.getByText('a fresh one')).not.toBeInViewport();
  await jump.click();
  await expect(list.getByText('and one more')).toBeInViewport();
  await expect(jump).toBeHidden();

  await alice.context.close();
  await bob.context.close();
});
