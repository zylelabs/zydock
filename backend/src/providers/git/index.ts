import config from '../../config';
import {
  GIT_HOSTS,
  type GitCredentials,
  type GitHost,
  type GitProvider,
  type GitProviderFactory,
} from './git.contract';

const factories: Partial<Record<GitHost, GitProviderFactory>> = {};

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

export type * from './git.contract';
