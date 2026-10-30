import { describe, expect, it } from 'vitest';
import {
  listMessagesQuerySchema,
  registerSchema,
  sendMessageSchema,
  usernameSchema,
} from './schemas.js';

describe('registerSchema', () => {
  it('normalizes email and trims username', () => {
    const parsed = registerSchema.parse({
      email: '  Alice@Example.COM ',
      username: ' alice_1 ',
      password: 'correct horse',
    });
    expect(parsed).toEqual({
      email: 'alice@example.com',
      username: 'alice_1',
      password: 'correct horse',
    });
  });

  it('rejects unknown fields', () => {
    const result = registerSchema.safeParse({
      email: 'a@b.co',
      username: 'alice',
      password: 'password1',
      isAdmin: true,
    });
    expect(result.success).toBe(false);
  });

  it('does not trim the password', () => {
    const parsed = registerSchema.parse({
      email: 'a@b.co',
      username: 'abc',
      password: ' 12345678 ',
    });
    expect(parsed.password).toBe(' 12345678 ');
  });
});

describe('usernameSchema', () => {
  it.each(['ab', 'a'.repeat(25), 'with space', 'emoji🙂', 'semi;colon'])('rejects %j', (value) => {
    expect(usernameSchema.safeParse(value).success).toBe(false);
  });

  it.each(['abc', 'John.Doe', 'user_42'])('accepts %j', (value) => {
    expect(usernameSchema.safeParse(value).success).toBe(true);
  });
});

describe('sendMessageSchema', () => {
  const clientMessageId = '7d444840-9dc0-4b8a-9f4e-6e0f5a6f8e11';

  it('trims text and rejects whitespace-only messages', () => {
    expect(sendMessageSchema.parse({ text: '  hi  ', clientMessageId }).text).toBe('hi');
    expect(sendMessageSchema.safeParse({ text: '   ', clientMessageId }).success).toBe(false);
  });

  it.each(['a\u0000b', 'a\u0007b', 'a\u001bb', 'a\u007fb', 'a\u0085b'])(
    'rejects the control character in %j',
    (text) => {
      expect(sendMessageSchema.safeParse({ text, clientMessageId }).success).toBe(false);
    },
  );

  it('keeps line breaks and tabs', () => {
    const text = 'one\r\n\ttwo\nthree';
    expect(sendMessageSchema.parse({ text, clientMessageId }).text).toBe(text);
  });

  it('requires a uuid client id', () => {
    expect(sendMessageSchema.safeParse({ text: 'hi', clientMessageId: '42' }).success).toBe(false);
  });
});

describe('listMessagesQuerySchema', () => {
  it('coerces query strings and applies the default limit', () => {
    expect(listMessagesQuerySchema.parse({ before: '10' })).toEqual({ before: 10, limit: 30 });
  });

  it('rejects before and after together', () => {
    expect(listMessagesQuerySchema.safeParse({ before: '10', after: '2' }).success).toBe(false);
  });
});
