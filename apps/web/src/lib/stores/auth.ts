import type { AuthResponse, LoginInput, MeDto, RegisterInput } from '@chat/shared';
import { derived, get, writable, type Readable } from 'svelte/store';
import { api, parse, useSession } from '../api/http.js';

export type AuthStatus = 'unknown' | 'authenticated' | 'anonymous';

export interface AuthState {
  status: AuthStatus;
  user: MeDto | null;
}

export interface AuthStore extends Readable<AuthState> {
  /** Restores the session from the refresh cookie; resolves with the resulting status. */
  init(): Promise<AuthStatus>;
  login(input: LoginInput): Promise<MeDto>;
  register(input: RegisterInput): Promise<MeDto>;
  logout(): Promise<void>;
  /** A new access token from the refresh cookie, or null when the session is gone. */
  refresh(): Promise<string | null>;
  /** The current access token if it is not about to expire, otherwise a refreshed one. */
  freshToken(): Promise<string | null>;
  token(): string | null;
}

interface Deps {
  fetch: typeof fetch;
  /** Web Locks serialize refreshes across tabs that share one refresh cookie. */
  locks?: Pick<LockManager, 'request'>;
  channel?: Pick<BroadcastChannel, 'postMessage' | 'addEventListener'>;
  /** Whether the API's non-secret session cookie is present; without it there is nothing to restore. */
  hasSessionHint?: () => boolean;
  now?: () => number;
}

const REFRESH_LOCK = 'chat:auth-refresh';
const EXPIRY_MARGIN_MS = 30_000;

export function createAuthStore(deps: Deps): AuthStore {
  const state = writable<AuthState>({ status: 'unknown', user: null });
  const now = deps.now ?? Date.now;
  let accessToken: string | null = null;
  let expiresAt = 0;
  let refreshing: Promise<string | null> | null = null;
  let initializing: Promise<AuthStatus> | null = null;

  function apply(response: AuthResponse): MeDto {
    accessToken = response.accessToken;
    expiresAt = now() + response.expiresIn * 1000;
    state.set({ status: 'authenticated', user: response.user });
    return response.user;
  }

  function clear() {
    accessToken = null;
    expiresAt = 0;
    state.set({ status: 'anonymous', user: null });
  }

  // Signing out in one tab signs out all of them.
  deps.channel?.addEventListener('message', (event) => {
    if ((event as MessageEvent).data === 'logout') {
      clear();
    }
  });

  function withLock<T>(task: () => Promise<T>): Promise<T> {
    return deps.locks ? (deps.locks.request(REFRESH_LOCK, task) as Promise<T>) : task();
  }

  function refresh(): Promise<string | null> {
    refreshing ??= withLock(async () => {
      const response = await deps.fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'same-origin',
      });
      if (response.status === 401) {
        clear();
        return null;
      }
      apply(await parse<AuthResponse>(response));
      return accessToken;
    }).finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  async function submit(path: string, input: LoginInput | RegisterInput): Promise<MeDto> {
    const response = await api<AuthResponse>(path, {
      method: 'POST',
      body: input,
      fetch: deps.fetch,
      anonymous: true,
    });
    return apply(response);
  }

  return {
    subscribe: state.subscribe,
    init() {
      const { status } = get(state);
      if (status !== 'unknown') {
        return Promise.resolve(status);
      }
      if (deps.hasSessionHint && !deps.hasSessionHint()) {
        clear();
        return Promise.resolve('anonymous');
      }
      initializing ??= refresh()
        .then((token): AuthStatus => (token ? 'authenticated' : 'anonymous'))
        .finally(() => {
          initializing = null;
        });
      return initializing;
    },
    login: (input) => submit('/auth/login', input),
    register: (input) => submit('/auth/register', input),
    async logout() {
      try {
        await deps.fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
      } finally {
        clear();
        deps.channel?.postMessage('logout');
      }
    },
    refresh,
    async freshToken() {
      if (accessToken && expiresAt - EXPIRY_MARGIN_MS > now()) {
        return accessToken;
      }
      return refresh();
    },
    token: () => accessToken,
  };
}

export const auth: AuthStore = createAuthStore({
  fetch: (...args) => fetch(...args),
  locks: typeof navigator !== 'undefined' ? navigator.locks : undefined,
  channel: typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('chat:auth') : undefined,
  hasSessionHint: () => typeof document !== 'undefined' && /(?:^|;\s*)sid=/.test(document.cookie),
});

useSession({ token: auth.token, refresh: auth.refresh });

export const currentUser = derived(auth, ($auth) => $auth.user);
