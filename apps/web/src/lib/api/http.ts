import type { ApiError } from '@chat/shared';

export class ApiRequestError extends Error {
  constructor(readonly error: ApiError) {
    super(error.message);
    this.name = 'ApiRequestError';
  }

  get status(): number {
    return this.error.statusCode;
  }

  get fieldErrors(): Record<string, string> {
    const details = Array.isArray(this.error.details) ? this.error.details : [];
    const result: Record<string, string> = {};
    for (const item of details as Array<{ path?: string; message?: string }>) {
      if (item.path && item.message && !(item.path in result)) {
        result[item.path] = item.message;
      }
    }
    return result;
  }
}

export interface Session {
  token(): string | null;
  /** Obtains a new access token; resolves null when the session is gone. */
  refresh(): Promise<string | null>;
}

let session: Session | null = null;

export function useSession(value: Session | null): void {
  session = value;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  signal?: AbortSignal;
  fetch?: typeof fetch;
  /** Sign-in requests: no token, and a 401 is the answer rather than a reason to refresh. */
  anonymous?: boolean;
}

/**
 * JSON request to the API. Adds the access token and, on a 401, refreshes it once and retries:
 * an expired token is routine, not an error the caller should see.
 */
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  if (options.anonymous) {
    return parse<T>(await send(path, options, null));
  }
  const response = await send(path, options, session?.token() ?? null);
  if (response.status === 401 && session) {
    const token = await session.refresh();
    if (token) {
      return parse<T>(await send(path, options, token));
    }
  }
  return parse<T>(response);
}

function send(path: string, options: RequestOptions, token: string | null): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const isForm = options.body instanceof FormData;
  if (options.body !== undefined && !isForm) {
    headers['Content-Type'] = 'application/json';
  }
  return (options.fetch ?? fetch)(withQuery(`/api${path}`, options.query), {
    method: options.method ?? 'GET',
    headers,
    body:
      options.body === undefined
        ? undefined
        : isForm
          ? (options.body as FormData)
          : JSON.stringify(options.body),
    credentials: 'same-origin',
    signal: options.signal,
  }).catch((error: unknown) => {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    throw new ApiRequestError({
      statusCode: 0,
      error: 'Network Error',
      message: 'Cannot reach the server. Check your connection.',
    });
  });
}

export async function parse<T>(response: Response): Promise<T> {
  if (response.status === 204) {
    return undefined as T;
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiRequestError(
      isApiError(body)
        ? body
        : {
            statusCode: response.status,
            error: response.statusText || 'Error',
            message: fallbackMessage(response.status),
          },
    );
  }
  return body as T;
}

/** For error responses that did not come from the API itself (a proxy, a gateway). */
function fallbackMessage(status: number): string {
  if (status === 429) {
    return 'Too many attempts. Wait a minute and try again.';
  }
  if (status === 502 || status === 503 || status === 504) {
    return 'The server is not available right now. Try again in a moment.';
  }
  return 'Something went wrong. Please try again.';
}

function isApiError(value: unknown): value is ApiError {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ApiError).statusCode === 'number' &&
    typeof (value as ApiError).message === 'string'
  );
}

function withQuery(url: string, query?: RequestOptions['query']): string {
  if (!query) {
    return url;
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') {
      params.set(key, String(value));
    }
  }
  const search = params.toString();
  return search ? `${url}?${search}` : url;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    return error.message;
  }
  return 'Something went wrong. Please try again.';
}
