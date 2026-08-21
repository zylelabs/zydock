import type { ISessionTokens } from '~/stores/session.store';

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  size: number;
  pages: number;
}

export type ApiQuery = Record<string, string | number | boolean | undefined>;

export type ApiRequest = {
  query?: ApiQuery;
  body?: unknown;
  anonymous?: boolean;
};

type ApiFailure = { statusCode?: number; data?: { statusCode?: number; error?: string } };

let renewal: Promise<boolean> | null = null;

const statusOf = (error: unknown) => {
  const failure = error as ApiFailure;

  return failure?.data?.statusCode ?? failure?.statusCode ?? 0;
};

const messageOf = (error: unknown) => {
  const failure = error as ApiFailure;

  return failure?.data?.error ?? 'Request failed';
};

export const renewSession = async () => {
  const session = useSessionStore();

  renewal ??= (
    $fetch('/api/proxy/auth/refresh', {
      method: 'POST',
      skipAuth: true,
    }) as Promise<ISessionTokens>
  )
    .then(tokens => {
      session.renew(tokens);

      return true;
    })
    .catch(() => {
      useSession().endSession();

      return false;
    })
    .finally(() => {
      renewal = null;
    });

  return renewal;
};

export const useApi = () => {
  const session = useSessionStore();

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
