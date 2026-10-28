import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { AuthService } from './auth/auth.service.js';
import { ConversationsService } from './conversations/conversations.service.js';
import { MessagesService } from './messages/messages.service.js';
import { UsersService } from './users/users.service.js';

/**
 * Demo data so a reviewer can sign in as two people right away. Safe to run repeatedly:
 * existing users are kept, and messages carry fixed client ids, so the idempotent send path
 * skips the ones already stored.
 */
const DEMO_PASSWORD = 'Password123!';
const USERNAMES = ['alice', 'bob', 'carol', 'dave'];

const SCRIPT: Array<{ between: [string, string]; messages: Array<[string, string]> }> = [
  {
    between: ['alice', 'bob'],
    messages: [
      ['bob', 'Hey Alice! Did the deploy go through?'],
      ['alice', 'Yes, all green. Both replicas picked it up.'],
      ['bob', 'Nice. Try sending me something from another tab 🙂'],
    ],
  },
  {
    between: ['carol', 'alice'],
    messages: [['carol', 'Lunch at 1?']],
  },
];

async function seed() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  try {
    const auth = app.get(AuthService);
    const users = app.get(UsersService);
    const conversations = app.get(ConversationsService);
    const messages = app.get(MessagesService);

    const ids = new Map<string, string>();
    for (const username of USERNAMES) {
      const email = `${username}@example.com`;
      const existing = await users.findByEmailWithPassword(email);
      if (existing) {
        ids.set(username, existing._id.toString());
      } else {
        const { response } = await auth.register({ email, username, password: DEMO_PASSWORD });
        ids.set(username, response.user.id);
      }
    }

    let n = 0;
    for (const { between, messages: lines } of SCRIPT) {
      const [a, b] = between.map((name) => ids.get(name)!);
      const { conversation } = await conversations.open(a!, b!);
      for (const [author, text] of lines) {
        n += 1;
        const clientMessageId = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
        await messages.send(conversation.id, ids.get(author)!, { text, clientMessageId });
      }
    }

    const emails = USERNAMES.map((u) => `${u}@example.com`).join(', ');
    process.stdout.write(`Demo users ready: ${emails} (password "${DEMO_PASSWORD}")\n`);
  } finally {
    await app.close();
  }
}

seed().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
