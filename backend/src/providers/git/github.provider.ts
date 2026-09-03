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
import {
  DEFAULT_BASE_URL,
  PAGE_SIZE,
  getAllPages as getAllPagesFrom,
  readHeader,
  send as sendTo,
  toRepository,
  type RepositoryResponse,
} from './github.client';

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

type PushCommitPaths = {
  added?: string[];
  removed?: string[];
  modified?: string[];
};

type PushPayload = {
  ref?: string;
  after?: string;
  deleted?: boolean;
  repository?: { full_name?: string };
  pusher?: { name?: string };
  commits?: Array<PushCommitPaths>;
  head_commit?:
    | ({
        id?: string;
        message?: string;
        timestamp?: string;
        author?: { name?: string; username?: string };
      } & PushCommitPaths)
    | null;
};

const MAX_COMMITS_WITH_FULL_PATHS = 20;

const collectChangedPaths = (payload: PushPayload): string[] => {
  const commits = payload.commits ?? [];

  if (commits.length === 0 || commits.length >= MAX_COMMITS_WITH_FULL_PATHS) {
    return [];
  }

  const allCommits = [...commits, payload.head_commit].filter(
    (commit): commit is PushCommitPaths => commit != null,
  );

  const changedPaths = new Set<string>();

  for (const commit of allCommits) {
    for (const path of [
      ...(commit.added ?? []),
      ...(commit.removed ?? []),
      ...(commit.modified ?? []),
    ]) {
      changedPaths.add(path);
    }
  }

  return [...changedPaths];
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

  const send = (url: string, init: { method?: string; body?: unknown } = {}) =>
    sendTo(headers(), url, init);

  const get = async <T>(path: string) => (await send(`${baseUrl}${path}`)).json() as Promise<T>;

  const getAllPages = <T>(path: string) => getAllPagesFrom<T>(headers(), `${baseUrl}${path}`);

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
        changedPaths: collectChangedPaths(payload),
      };
    },
  };
};
