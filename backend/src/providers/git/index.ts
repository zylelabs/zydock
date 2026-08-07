import config from '../../config';
import {
  GIT_HOSTS,
  type GitAppCredentials,
  type GitAppProvider,
  type GitCredentials,
  type GitHost,
  type GitProvider,
  type GitProviderFactory,
  type GitReleasesCredentials,
  type GitReleasesProvider,
} from './git.contract';
import { createGithubAppProvider } from './github-app.provider';
import { createGithubReleasesProvider } from './github-releases.provider';
import { createGithubProvider } from './github.provider';

const factories: Partial<Record<GitHost, GitProviderFactory>> = {
  github: createGithubProvider,
};

const isGitHost = (value: string): value is GitHost => GIT_HOSTS.some(host => host === value);

export const resolveGitProvider = (credentials: GitCredentials): GitProvider => {
  const host = credentials.host ?? config.providers.git.defaultHost;

  if (!isGitHost(host)) {
    throw new Error(`Unknown git host "${host}"`);
  }

  const factory = factories[host];

  if (!factory) {
    throw new Error(`Git host "${host}" has no registered implementation`);
  }

  return factory({ ...credentials, host });
};

export const resolveGitAppProvider = (credentials: GitAppCredentials): GitAppProvider =>
  createGithubAppProvider(credentials);

export const resolveGitReleasesProvider = (
  credentials: GitReleasesCredentials,
): GitReleasesProvider => createGithubReleasesProvider(credentials);

export type * from './git.contract';
