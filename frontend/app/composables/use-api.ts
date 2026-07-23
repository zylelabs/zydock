import type { ISessionTokens } from '~/stores/session.store';

export type ApiQuery = Record<string, string | number | boolean | undefined>;

export type ApiRequest = {
  query?: ApiQuery;
  body?: unknown;
  /** Skips the access token — used by sign in, sign up and the refresh call itself. */
  anonymous?: boolean;
};

type ApiFailure = { statusCode?: number; data?: { statusCode?: number; error?: string } };

/**
 * One refresh at a time: several requests failing with 401 at once must not rotate the refresh
 * token several times — the backend invalidates the previous one on each rotation.
 */
let renewal: Promise<boolean> | null = null;

const statusOf = (error: unknown) => {
  const failure = error as ApiFailure;

  return failure?.data?.statusCode ?? failure?.statusCode ?? 0;
};

const messageOf = (error: unknown) => {
  const failure = error as ApiFailure;

  return failure?.data?.error ?? 'Request failed';
};

/**
 * Rotates the session with the refresh token. Exported because the WebSocket needs it too: a socket
 * that drops after the access token expired only comes back with a new one.
 */
export const renewSession = async () => {
  const session = useSessionStore();

  if (!session.refreshToken) {
    return false;
  }

  renewal ??= (
    $fetch('/api/proxy/auth/refresh', {
      method: 'POST',
      body: { refreshToken: session.refreshToken },
    }) as Promise<ISessionTokens>
  )
    .then(tokens => {
      session.renew(tokens);

      return true;
    })
    .catch(() => {
      session.clear();

      return false;
    })
    .finally(() => {
      renewal = null;
    });

  return renewal;
};

/**
 * Access to the API. Every call goes to the Nitro proxy — the browser never learns the API URL —
 * and carries the access token of the session.
 */
export const useApi = () => {
  const session = useSessionStore();

  // The cast is needed because Nitro types every internal route, and this one is a passthrough:
  // the shape of the answer is the API's, and only the caller knows it.
  const send = <T>(method: string, path: string, options: ApiRequest) =>
    $fetch(`/api/proxy${path}`, {
      method: method as 'GET',
      query: options.query,
      body: options.body as Record<string, unknown> | undefined,
      headers:
        options.anonymous || !session.accessToken
          ? undefined
          : { authorization: `Bearer ${session.accessToken}` },
    }) as Promise<T>;

  const request = async <T>(method: string, path: string, options: ApiRequest = {}): Promise<T> => {
    try {
      return await send<T>(method, path, options);
    } catch (error) {
      const status = statusOf(error);

      // An expired access token is not a failure: renew it once and repeat the request.
      if (status === 401 && !options.anonymous && (await renewSession())) {
        try {
          return await send<T>(method, path, options);
        } catch (retried) {
          throw createError({ statusCode: statusOf(retried), message: messageOf(retried) });
        }
      }

      throw createError({ statusCode: status, message: messageOf(error) });
    }
  };

  return {
    request,
    get: <T>(path: string, options?: ApiRequest) => request<T>('GET', path, options),
    post: <T>(path: string, options?: ApiRequest) => request<T>('POST', path, options),
    patch: <T>(path: string, options?: ApiRequest) => request<T>('PATCH', path, options),
    put: <T>(path: string, options?: ApiRequest) => request<T>('PUT', path, options),
    del: <T>(path: string, options?: ApiRequest) => request<T>('DELETE', path, options),
  };
};
