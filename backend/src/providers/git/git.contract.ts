export const GIT_HOSTS = ['github', 'gitlab', 'bitbucket', 'gitea'] as const;

export type GitHost = (typeof GIT_HOSTS)[number];

export type GitCredentials = {
  token: string;
  host?: GitHost;
  baseUrl?: string;
};

export type GitRepository = {
  id: string;
  name: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  cloneUrl: string;
};

export type GitBranch = {
  name: string;
  commitSha: string;
  protected: boolean;
};

export type GitCommit = {
  sha: string;
  message: string;
  author: string;
  committedAt: string;
};

export type GitWebhook = {
  id: string;
  url: string;
  events: string[];
};

export type GitWebhookRequest = {
  headers: Record<string, string>;
  body: string;
};

export type GitPushEvent = {
  repositoryFullName: string;
  branch: string;
  commitSha: string;
  commitMessage: string;
  author: string;
  pushedAt: string;
  /** Paths touched by the push. Empty means unknown, not "nothing changed". */
  changedPaths: string[];
};

export type GitProvider = {
  listRepositories: () => Promise<GitRepository[]>;
  listBranches: (repositoryFullName: string) => Promise<GitBranch[]>;
  resolveCommit: (repositoryFullName: string, reference: string) => Promise<GitCommit>;
  getCloneUrl: (repositoryFullName: string) => Promise<string>;
  createWebhook: (
    repositoryFullName: string,
    callbackUrl: string,
    secret: string,
  ) => Promise<GitWebhook>;
  deleteWebhook: (repositoryFullName: string, webhookId: string) => Promise<void>;
  verifyWebhook: (request: GitWebhookRequest, secret: string) => Promise<boolean>;
  parseWebhookEvent: (request: GitWebhookRequest) => GitPushEvent | null;
};

export type GitProviderFactory = (credentials: GitCredentials) => GitProvider;

export type GitAppCredentials = { appId: string; privateKey: string; baseUrl?: string };

export type GitInstallation = {
  id: string;
  account: string;
  accountType: string;
  repositorySelection: string;
  htmlUrl: string;
};

export type GitAppRegistration = {
  appId: string;
  slug: string;
  name: string;
  htmlUrl: string;
  clientId: string;
  clientSecret: string;
  webhookSecret: string;
  privateKey: string;
};

export type GitAppProvider = {
  listInstallations: () => Promise<GitInstallation[]>;
  listRepositories: (installationId: string) => Promise<GitRepository[]>;
  createInstallationToken: (
    installationId: string,
  ) => Promise<{ token: string; expiresAt: string }>;
};

export type GitAppProviderFactory = (credentials: GitAppCredentials) => GitAppProvider;

export type GitReleasesCredentials = { repository: string; baseUrl?: string };

export type GitReleaseHead = {
  ref: string;
  version: string;
  commit: string;
};

export type GitReleasesProvider = {
  resolveLatestRelease: () => Promise<GitReleaseHead>;
  resolveBranchHead: (branch: string) => Promise<GitReleaseHead>;
};

export type GitReleasesProviderFactory = (
  credentials: GitReleasesCredentials,
) => GitReleasesProvider;
