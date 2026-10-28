import { escapeRegex } from './escape-regex.js';

describe('escapeRegex', () => {
  it.each(['.*', 'a+b', '(x)', '[a-z]', '^$', 'a|b', '\\', '{2}', 'a?', '/'])(
    'makes %j match only itself',
    (input) => {
      const re = new RegExp(`^${escapeRegex(input)}$`);
      expect(re.test(input)).toBe(true);
      expect(re.test(`${input}x`)).toBe(false);
    },
  );

  it('leaves plain usernames untouched', () => {
    expect(escapeRegex('john_doe42')).toBe('john_doe42');
  });
});
