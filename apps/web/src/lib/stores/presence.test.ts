import { describe, expect, it } from 'vitest';
import { peerStatus } from './presence.js';

describe('peerStatus', () => {
  it.each([
    // Our own connection is down: the last known flag says nothing about the peer.
    ['offline', true, false, 'connecting'],
    ['offline', false, false, 'connecting'],
    ['connecting', undefined, true, 'connecting'],
    // Connected, but the flag has not arrived yet: that is not the same as offline.
    ['online', undefined, false, null],
    ['online', false, false, 'offline'],
    ['online', true, false, 'online'],
    ['online', true, true, 'typing'],
  ] as const)('connection %s, flag %s, typing %s: %s', (connection, online, typing, expected) => {
    expect(peerStatus(connection, online, typing)).toBe(expected);
  });
});
