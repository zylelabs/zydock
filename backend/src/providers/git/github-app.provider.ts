import { createSign } from 'node:crypto';
import type {
  GitAppCredentials,
  GitAppProvider,
  GitAppRegistration,
  GitInstallation,
} from './git.contract';
import {
  DEFAULT_BASE_URL,
  MAX_PAGES,
  getAllPages,
  nextPageUrl,
  send,
  toRepository,
  type RepositoryResponse,
} from './github.client';

const JWT_CLOCK_SKEW_SECONDS = 60;
const JWT_EXPIRATION_SECONDS = 9 * 60;

type InstallationResponse = {
  id: number;
  account: { login: string; type: string };
  repository_selection: string;
  html_url: string;
};

type InstallationTokenResponse = {
  token: string;
  expires_at: string;
};

type ManifestConversionResponse = {
  id: number;
  slug: string;
  name: string;
  html_url: string;
  client_id: string;
  client_secret: string;
  webhook_secret: string;
  pem: string;
};

const base64url = (value: Buffer) =>
  value.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const signAppJwt = (appId: string, privateKey: string) => {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iat: now - JWT_CLOCK_SKEW_SECONDS,
    exp: now + JWT_EXPIRATION_SECONDS,
    iss: appId,
  };

  const signingInput = `${base64url(Buffer.from(JSON.stringify(header)))}.${base64url(Buffer.from(JSON.stringify(payload)))}`;
  const signature = createSign('RSA-SHA256').update(signingInput).sign(privateKey);

  return `${signingInput}.${base64url(signature)}`;
};

const toInstallation = (installation: InstallationResponse): GitInstallation => ({
  id: String(installation.id),
  account: installation.account.login,
  accountType: installation.account.type,
  repositorySelection: installation.repository_selection,
  htmlUrl: installation.html_url,
});

export const createGithubAppProvider = (credentials: GitAppCredentials): GitAppProvider => {
  const baseUrl = (credentials.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');

  const appHeaders = () => ({
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'zydock',
    Authorization: `Bearer ${signAppJwt(credentials.appId, credentials.privateKey)}`,
  });

  const installationHeaders = (token: string) => ({
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'zydock',
    Authorization: `Bearer ${token}`,
  });

  const createInstallationToken = async (installationId: string) => {
    const response = await send(
      appHeaders(),
      `${baseUrl}/app/installations/${encodeURIComponent(installationId)}/access_tokens`,
      { method: 'POST' },
    );

    const body = (await response.json()) as InstallationTokenResponse;

    return { token: body.token, expiresAt: body.expires_at };
  };

  return {
    listInstallations: async () =>
      (await getAllPages<InstallationResponse>(appHeaders(), `${baseUrl}/app/installations`)).map(
        toInstallation,
      ),

    createInstallationToken,

    listRepositories: async installationId => {
      const { token } = await createInstallationToken(installationId);
      const headers = installationHeaders(token);

      const repositories: RepositoryResponse[] = [];
      let url: string | null = `${baseUrl}/installation/repositories`;
      let page = 0;

      while (url && page < MAX_PAGES) {
        const response = await send(headers, url);
        const body = (await response.json()) as { repositories: RepositoryResponse[] };

        repositories.push(...body.repositories);

        url = nextPageUrl(response.headers.get('link'));
        page += 1;
      }

      return repositories.map(toRepository);
    },
  };
};

export const exchangeGithubManifest = async (
  code: string,
  baseUrl = DEFAULT_BASE_URL,
): Promise<GitAppRegistration> => {
  const response = await send(
    {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'zydock',
    },
    `${baseUrl.replace(/\/+$/, '')}/app-manifests/${encodeURIComponent(code)}/conversions`,
    { method: 'POST' },
  );

  const body = (await response.json()) as ManifestConversionResponse;

  return {
    appId: String(body.id),
    slug: body.slug,
    name: body.name,
    htmlUrl: body.html_url,
    clientId: body.client_id,
    clientSecret: body.client_secret,
    webhookSecret: body.webhook_secret,
    privateKey: body.pem,
  };
};
