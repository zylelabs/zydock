import type { GitReleaseHead, GitReleasesCredentials, GitReleasesProvider } from './git.contract';
import { DEFAULT_BASE_URL, send as sendTo } from './github.client';

type ReleaseResponse = { tag_name: string };

type CommitResponse = { sha: string };

export const createGithubReleasesProvider = (
  credentials: GitReleasesCredentials,
): GitReleasesProvider => {
  const baseUrl = (credentials.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');

  const repositoryPath = `/repos/${credentials.repository
    .split('/')
    .map(part => encodeURIComponent(part))
    .join('/')}`;

  const headers = () => ({
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'zydock',
  });

  const get = async <T>(path: string) =>
    (await sendTo(headers(), `${baseUrl}${repositoryPath}${path}`)).json() as Promise<T>;

  const resolveCommit = async (reference: string) => {
    const commit = await get<CommitResponse>(`/commits/${encodeURIComponent(reference)}`);

    return commit.sha;
  };

  return {
    resolveLatestRelease: async () => {
      const { tag_name: tag } = await get<ReleaseResponse>('/releases/latest');

      if (!tag) {
        throw new Error(
          `GitHub returned no tag for the latest release of ${credentials.repository}`,
        );
      }

      return { ref: tag, version: tag, commit: await resolveCommit(tag) } satisfies GitReleaseHead;
    },

    resolveBranchHead: async branch =>
      ({
        ref: branch,
        version: '',
        commit: await resolveCommit(branch),
      }) satisfies GitReleaseHead,
  };
};
