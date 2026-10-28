/**
 * Where to go after signing in. Only same-site paths are accepted, otherwise a crafted
 * `?next=https://evil.example` link would turn the login page into an open redirect.
 */
export function safeNext(value: string | null, fallback = '/chats'): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return fallback;
  }
  return value;
}
