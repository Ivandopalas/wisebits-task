import { expect, test, type WebSocketRoute } from '@playwright/test';
import { messageList, openConversationWith, sendMessage, signedInUser } from './helpers.js';

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
  // Alice sees that Bob has read it.
  await expect(messageList(alice.page).getByTestId('message-read')).toHaveCount(1);

  // Typing indicator, then the reply.
  await bob.page.getByRole('textbox', { name: 'Message' }).pressSequentially('Yes!', { delay: 50 });
  await expect(alice.page.getByTestId('chat-status')).toHaveText('typing…');
  await bob.page.getByRole('textbox', { name: 'Message' }).press('Enter');
  await expect(messageList(alice.page)).toContainText('Yes!');
  await expect(alice.page.getByTestId('chat-status')).toHaveText('online');

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

test('a dropped connection recovers: missed messages arrive, queued ones are delivered', async ({
  browser,
}) => {
  const alice = await signedInUser(browser);
  const bob = await signedInUser(browser);

  // Offline emulation alone leaves an open WebSocket alive, so Alice's socket goes through a
  // route that can cut it and refuse new connections, like a real network drop.
  let networkUp = true;
  const liveSockets: WebSocketRoute[] = [];
  await alice.page.routeWebSocket(/\/socket\.io\//, (ws) => {
    if (!networkUp) {
      void ws.close();
      return;
    }
    ws.connectToServer();
    liveSockets.push(ws);
  });
  await alice.page.reload();

  await openConversationWith(alice, bob);
  await sendMessage(alice.page, 'before the outage');
  await openConversationWith(bob, alice);
  await expect(messageList(bob.page)).toContainText('before the outage');

  networkUp = false;
  await alice.context.setOffline(true);
  await Promise.all(liveSockets.splice(0).map((ws) => ws.close()));
  await expect(alice.page.getByTestId('connection-banner')).toBeVisible();

  await sendMessage(bob.page, 'sent while Alice was offline');
  await sendMessage(alice.page, 'typed while offline');
  const queued = messageList(alice.page)
    .getByTestId('message')
    .filter({ hasText: 'typed while offline' });
  await expect(queued).not.toHaveAttribute('data-status', 'sent');

  networkUp = true;
  await alice.context.setOffline(false);
  await expect(alice.page.getByTestId('connection-banner')).toBeHidden({ timeout: 20_000 });
  await expect(messageList(alice.page)).toContainText('sent while Alice was offline');
  await expect(queued).toHaveAttribute('data-status', 'sent', { timeout: 20_000 });
  await expect(messageList(bob.page)).toContainText('typed while offline');
  // Delivered exactly once despite the retry.
  await expect(messageList(bob.page).getByText('typed while offline')).toHaveCount(1);

  await alice.context.close();
  await bob.context.close();
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
  await expect(list).toContainText('This is the beginning of the conversation');

  // Reading old messages, Bob is not yanked to the bottom by a new one; a button offers to jump.
  await sendMessage(alice.page, 'a fresh one');
  const jump = bob.page.getByTestId('jump-to-latest');
  await expect(jump).toContainText('1');
  await expect(list.getByText('history 1', { exact: true })).toBeInViewport();
  await jump.click();
  await expect(list.getByText('a fresh one')).toBeInViewport();
  await expect(jump).toBeHidden();

  await alice.context.close();
  await bob.context.close();
});
