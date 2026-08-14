import { randomBytes } from 'node:crypto';
import config from '../../config';
import { resolveGitAppProvider } from '../../providers/git';
import { exchangeGithubManifest } from '../../providers/git/github-app.provider';
import { decryptSecret, encryptSecret } from '../../utils/crypto';
import { resolvePublicUrl } from '../dashboard/dashboard.service';
import gitSourceModel from './git-source.model';
import type { CreateManifestDTO, ManifestCallbackDTO } from './git-source.schema';

const STATE_BYTES = 32;
const STATE_TTL_MINUTES = 15;

export const findGitSource = (organizationId: string, gitSourceId: string) =>
  gitSourceModel.findOne({ _id: gitSourceId, organizationId });

export const startManifestRegistration = async (
  organizationId: string,
  userId: string,
  body: CreateManifestDTO,
) => {
  const state = randomBytes(STATE_BYTES).toString('hex');
  const stateExpiresAt = new Date(Date.now() + STATE_TTL_MINUTES * 60 * 1000);

  const gitSource = await gitSourceModel.create({
    organizationId,
    name: body.name,
    status: 'pending',
    state,
    stateExpiresAt,
    createdBy: userId,
  });

  const gitSourceId = String(gitSource._id);
  const publicUrl = await resolvePublicUrl();

  const manifest = {
    name: body.name,
    url: publicUrl,
    redirect_url: `${publicUrl}/git-sources/callback`,
    setup_url: `${publicUrl}/settings?tab=git`,
    hook_attributes: {
      url: `${config.backendUrl}/api/webhooks/github-app/${gitSourceId}`,
      active: true,
    },
    public: false,
    default_events: ['push'],
    default_permissions: { contents: 'read', metadata: 'read' },
  };

  const postUrl = body.organization
    ? `https://github.com/organizations/${encodeURIComponent(body.organization)}/settings/apps/new?state=${encodeURIComponent(state)}`
    : `https://github.com/settings/apps/new?state=${encodeURIComponent(state)}`;

  return { gitSource: serializeGitSource(gitSource), state, manifest, postUrl };
};

export const completeManifestRegistration = async (
  organizationId: string,
  body: ManifestCallbackDTO,
) => {
  const gitSource = await gitSourceModel
    .findOne({ organizationId, state: body.state })
    .select('+state');

  if (!gitSource || gitSource.status !== 'pending') {
    return null;
  }

  if (!gitSource.stateExpiresAt || gitSource.stateExpiresAt.getTime() < Date.now()) {
    return null;
  }

  const registration = await exchangeGithubManifest(body.code);

  await gitSourceModel.updateOne(
    { _id: gitSource._id },
    {
      $set: {
        status: 'active',
        appId: registration.appId,
        slug: registration.slug,
        htmlUrl: registration.htmlUrl,
        clientId: registration.clientId,
        clientSecret: encryptSecret(registration.clientSecret),
        webhookSecret: encryptSecret(registration.webhookSecret),
        privateKey: encryptSecret(registration.privateKey),
      },
      $unset: { state: '', stateExpiresAt: '' },
    },
  );

  return findGitSource(organizationId, String(gitSource._id));
};

const providerOf = (gitSource: GitSource) => {
  if (!gitSource.appId || !gitSource.privateKey) {
    throw new Error('Git source has no active GitHub App registration');
  }

  return resolveGitAppProvider({
    appId: gitSource.appId,
    privateKey: decryptSecret(gitSource.privateKey),
  });
};

export const issueInstallationToken = async (gitSourceId: string, installationId: string) => {
  const gitSource = await gitSourceModel.findById(gitSourceId).select('+privateKey');

  if (!gitSource) {
    throw new Error('Git source has no active GitHub App registration');
  }

  const { token } = await providerOf(gitSource).createInstallationToken(installationId);

  return token;
};

export const listGitSourceInstallations = async (organizationId: string, gitSourceId: string) => {
  const gitSource = await gitSourceModel
    .findOne({ _id: gitSourceId, organizationId })
    .select('+privateKey');

  if (!gitSource) {
    return null;
  }

  return providerOf(gitSource).listInstallations();
};

export const listGitSourceRepositories = async (
  organizationId: string,
  gitSourceId: string,
  installationId: string,
) => {
  const gitSource = await gitSourceModel
    .findOne({ _id: gitSourceId, organizationId })
    .select('+privateKey');

  if (!gitSource) {
    return null;
  }

  return providerOf(gitSource).listRepositories(installationId);
};

export const serializeGitSource = (gitSource: GitSource) => ({
  id: String(gitSource._id),
  organizationId: String(gitSource.organizationId),
  name: gitSource.name,
  status: gitSource.status,
  appId: gitSource.appId,
  slug: gitSource.slug,
  htmlUrl: gitSource.htmlUrl,
  clientId: gitSource.clientId,
  createdAt: gitSource.createdAt,
  updatedAt: gitSource.updatedAt,
});
