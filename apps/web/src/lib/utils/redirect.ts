const SITE = 'https://site.invalid';

/**
 * Where to go after signing in. Only same-site paths are accepted, otherwise a crafted
 * `?next=https://evil.example` link would turn the login page into an open redirect. The URL
 * parser decides, as it will in the browser: `/\t/evil.example` looks like a path, but loses the
 * tab there and becomes `//evil.example`.
 */
export function safeNext(value: string | null, fallback = '/chats'): string {
  if (!value?.startsWith('/')) {
    return fallback;
  }
  try {
    const { origin, pathname, search, hash } = new URL(value, SITE);
    return origin === SITE && !pathname.startsWith('//') ? pathname + search + hash : fallback;
  } catch {
    return fallback;
  }
}
