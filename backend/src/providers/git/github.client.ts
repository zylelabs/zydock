import { describeConnectionFailure } from '../../utils/network';
import type { GitRepository } from './git.contract';

export const DEFAULT_BASE_URL = 'https://api.github.com';
export const PAGE_SIZE = 100;
export const MAX_PAGES = 10;
export const REQUEST_TIMEOUT_MS = 15000;
export const RETRY_ATTEMPTS = 3;
export const RETRY_DELAY_MS = 1000;

export type RepositoryResponse = {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  clone_url: string;
};

export const toRepository = (repository: RepositoryResponse): GitRepository => ({
  id: String(repository.id),
  name: repository.name,
  fullName: repository.full_name,
  private: repository.private,
  defaultBranch: repository.default_branch,
  cloneUrl: repository.clone_url,
});

export const readHeader = (headers: Record<string, string>, name: string) => {
  const wanted = name.toLowerCase();

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) {
      return value;
    }
  }

  return undefined;
};

export const nextPageUrl = (link: string | null) => {
  if (!link) {
    return null;
  }

  for (const part of link.split(',')) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="next"/);

    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
};

export const send = async (
  headers: Record<string, string>,
  url: string,
  init: { method?: string; body?: unknown } = {},
) => {
  const { method = 'GET', body } = init;

  let response: Response | undefined;
  let failure: unknown;

  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt += 1) {
    try {
      response = await fetch(url, {
        method,
        headers: {
          ...headers,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      break;
    } catch (error) {
      failure = error;

      if (attempt < RETRY_ATTEMPTS) {
        await Bun.sleep(RETRY_DELAY_MS * attempt);
      }
    }
  }

  if (!response) {
    throw new Error(
      `GitHub did not answer ${method} ${url} after ${RETRY_ATTEMPTS} attempts: ${await describeConnectionFailure(url, failure)}`,
    );
  }

  if (!response.ok) {
    const detail = await response.text();

    let message = detail;

    try {
      const parsed = JSON.parse(detail) as { message?: unknown };

      if (typeof parsed.message === 'string') {
        message = parsed.message;
      }
    } catch {
      message = detail.trim() || `HTTP ${response.status}`;
    }

    throw new Error(`GitHub refused ${method} ${url}: ${message}`);
  }

  return response;
};

export const getAllPages = async <T>(headers: Record<string, string>, path: string) => {
  const items: T[] = [];

  let url: string | null = path;
  let page = 0;

  while (url && page < MAX_PAGES) {
    const response: Response = await send(headers, url);

    items.push(...((await response.json()) as T[]));

    url = nextPageUrl(response.headers.get('link'));
    page += 1;
  }

  return items;
};
