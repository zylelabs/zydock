import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  GitBranch,
  GitCommit,
  GitCredentials,
  GitProvider,
  GitPushEvent,
  GitRepository,
  GitWebhook,
  GitWebhookRequest,
} from './git.contract';

const DEFAULT_BASE_URL = 'https://api.github.com';
const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const REQUEST_TIMEOUT_MS = 15000;

type RepositoryResponse = {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  clone_url: string;
};

type BranchResponse = {
  name: string;
  protected?: boolean;
  commit: { sha: string };
};

type CommitResponse = {
  sha: string;
  commit: {
    message: string;
    author: { name?: string; date?: string };
  };
};

type WebhookResponse = {
  id: number;
  events: string[];
  config: { url?: string };
};

type PushPayload = {
  ref?: string;
  after?: string;
  deleted?: boolean;
  repository?: { full_name?: string };
  pusher?: { name?: string };
  head_commit?: {
    id?: string;
    message?: string;
    timestamp?: string;
    author?: { name?: string; username?: string };
  } | null;
};

const toRepository = (repository: RepositoryResponse): GitRepository => ({
  id: String(repository.id),
  name: repository.name,
  fullName: repository.full_name,
  private: repository.private,
  defaultBranch: repository.default_branch,
  cloneUrl: repository.clone_url,
});

const readHeader = (headers: Record<string, string>, name: string) => {
  const wanted = name.toLowerCase();

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) {
      return value;
    }
  }

  return undefined;
};

const nextPageUrl = (link: string | null) => {
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

const signBody = (body: string, secret: string) =>
  `sha256=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`;

const matchesSignature = (expected: string, received: string) => {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(received, 'utf8');

  if (a.length !== b.length) {
    return false;
  }

  return timingSafeEqual(a, b);
};

export const createGithubProvider = (credentials: GitCredentials): GitProvider => {
  const baseUrl = (credentials.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');

  const headers = () => ({
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'zydock',
    ...(credentials.token ? { Authorization: `Bearer ${credentials.token}` } : {}),
  });

  const send = async (url: string, init: { method?: string; body?: unknown } = {}) => {
    const { method = 'GET', body } = init;

    let response: Response;

    try {
      response = await fetch(url, {
        method,
        headers: {
          ...headers(),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);

      throw new Error(`GitHub did not answer ${method} ${url}: ${reason}`);
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

  const get = async <T>(path: string) => (await send(`${baseUrl}${path}`)).json() as Promise<T>;

  const getAllPages = async <T>(path: string) => {
    const items: T[] = [];

    let url: string | null = `${baseUrl}${path}`;
    let page = 0;

    while (url && page < MAX_PAGES) {
      const response: Response = await send(url);

      items.push(...((await response.json()) as T[]));

      url = nextPageUrl(response.headers.get('link'));
      page += 1;
    }

    return items;
  };

  const repositoryPath = (fullName: string) =>
    `/repos/${fullName
      .split('/')
      .map(part => encodeURIComponent(part))
      .join('/')}`;

  return {
    listRepositories: async () =>
      (await getAllPages<RepositoryResponse>(`/user/repos?per_page=${PAGE_SIZE}&sort=updated`)).map(
        toRepository,
      ),

    listBranches: async fullName =>
      (
        await getAllPages<BranchResponse>(
          `${repositoryPath(fullName)}/branches?per_page=${PAGE_SIZE}`,
        )
      ).map((branch): GitBranch => ({
        name: branch.name,
        commitSha: branch.commit.sha,
        protected: branch.protected ?? false,
      })),

    resolveCommit: async (fullName, reference) => {
      const commit = await get<CommitResponse>(
        `${repositoryPath(fullName)}/commits/${encodeURIComponent(reference)}`,
      );

      return {
        sha: commit.sha,
        message: commit.commit.message,
        author: commit.commit.author.name ?? '',
        committedAt: commit.commit.author.date ?? '',
      } satisfies GitCommit;
    },

    getCloneUrl: async fullName => {
      const { clone_url: cloneUrl } = await get<RepositoryResponse>(repositoryPath(fullName));

      if (!credentials.token) {
        return cloneUrl;
      }

      const url = new URL(cloneUrl);

      url.username = 'x-access-token';
      url.password = credentials.token;

      return url.toString();
    },

    createWebhook: async (fullName, callbackUrl, secret) => {
      const response = await send(`${baseUrl}${repositoryPath(fullName)}/hooks`, {
        method: 'POST',
        body: {
          name: 'web',
          active: true,
          events: ['push'],
          config: { url: callbackUrl, content_type: 'json', secret, insecure_ssl: '0' },
        },
      });

      const webhook = (await response.json()) as WebhookResponse;

      return {
        id: String(webhook.id),
        url: webhook.config.url ?? callbackUrl,
        events: webhook.events,
      } satisfies GitWebhook;
    },

    deleteWebhook: async (fullName, webhookId) => {
      await send(`${baseUrl}${repositoryPath(fullName)}/hooks/${encodeURIComponent(webhookId)}`, {
        method: 'DELETE',
      });
    },

    verifyWebhook: async (request: GitWebhookRequest, secret) => {
      const received = readHeader(request.headers, 'x-hub-signature-256');

      if (!received || !secret) {
        return false;
      }

      return matchesSignature(signBody(request.body, secret), received);
    },

    parseWebhookEvent: (request: GitWebhookRequest): GitPushEvent | null => {
      if (readHeader(request.headers, 'x-github-event') !== 'push') {
        return null;
      }

      let payload: PushPayload;

      try {
        payload = JSON.parse(request.body) as PushPayload;
      } catch {
        return null;
      }

      if (payload.deleted || !payload.ref?.startsWith('refs/heads/')) {
        return null;
      }

      const commitSha = payload.head_commit?.id ?? payload.after;

      if (!payload.repository?.full_name || !commitSha) {
        return null;
      }

      return {
        repositoryFullName: payload.repository.full_name,
        branch: payload.ref.slice('refs/heads/'.length),
        commitSha,
        commitMessage: payload.head_commit?.message ?? '',
        author:
          payload.head_commit?.author?.username ??
          payload.head_commit?.author?.name ??
          payload.pusher?.name ??
          '',
        pushedAt: payload.head_commit?.timestamp ?? new Date().toISOString(),
      };
    },
  };
};
