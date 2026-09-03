import { randomBytes } from 'node:crypto';
import config from '../../config';
import { resolveGitProvider, type GitWebhookRequest } from '../../providers/git';
import { decryptSecret, encryptSecret } from '../../utils/crypto';
import { logInfo, logWarn } from '../../utils/logger';
import { enqueueDeployment } from '../deployments/pipeline.service';
import applicationModel from './application.model';
import { resolveGitCredentials } from './application.service';

const SECRET_BYTES = 32;

export type WebhookOutcome =
  { accepted: true; deploymentId: string; commit: string } | { accepted: false; reason: string };

const gitProviderOf = async (application: Application) =>
  resolveGitProvider(await resolveGitCredentials(application));

export const matchesWatchPaths = (watchPaths: string[], changedPaths: string[]) => {
  if (!watchPaths.length || !changedPaths.length) {
    return true;
  }

  return changedPaths.some(changedPath =>
    watchPaths.some(
      watchPath => changedPath === watchPath || changedPath.startsWith(`${watchPath}/`),
    ),
  );
};

export const callbackUrlOf = (applicationId: string) =>
  `${config.backendUrl}/api/webhooks/git/${applicationId}`;

export const configureWebhook = async (application: Application) => {
  const secret = randomBytes(SECRET_BYTES).toString('hex');
  const applicationId = String(application._id);
  const git = await gitProviderOf(application);

  if (application.git.webhookId) {
    await git
      .deleteWebhook(application.git.repository!, application.git.webhookId)
      .catch(error => logWarn('Could not remove the previous webhook', { error: String(error) }));
  }

  const webhook = await git.createWebhook(
    application.git.repository!,
    callbackUrlOf(applicationId),
    secret,
  );

  await applicationModel.updateOne(
    { _id: applicationId },
    { $set: { 'git.webhookId': webhook.id, 'git.webhookSecret': encryptSecret(secret) } },
  );

  logInfo('Git webhook configured', { application: applicationId, webhook: webhook.id });

  return webhook;
};

export const removeWebhook = async (application: Application) => {
  if (!application.git.webhookId) {
    return false;
  }

  await (
    await gitProviderOf(application)
  ).deleteWebhook(application.git.repository!, application.git.webhookId);

  await applicationModel.updateOne(
    { _id: application._id },
    { $unset: { 'git.webhookId': '', 'git.webhookSecret': '' } },
  );

  return true;
};

export const handleGitWebhook = async (
  application: Application,
  request: GitWebhookRequest,
): Promise<WebhookOutcome> => {
  if (application.source === 'compose') {
    return { accepted: false, reason: 'Auto deploy via push is disabled for compose applications' };
  }

  if (!application.git.webhookSecret) {
    return { accepted: false, reason: 'This application has no webhook configured' };
  }

  const git = await gitProviderOf(application);
  const secret = decryptSecret(application.git.webhookSecret);

  if (!(await git.verifyWebhook(request, secret))) {
    return { accepted: false, reason: 'Invalid signature' };
  }

  const event = git.parseWebhookEvent(request);

  if (!event) {
    return { accepted: false, reason: 'Not a deployable push event' };
  }

  if (event.branch !== application.git.branch) {
    return { accepted: false, reason: `Push to "${event.branch}" ignored` };
  }

  if (!application.git.autoDeploy) {
    return { accepted: false, reason: 'Auto deploy is disabled for this application' };
  }

  if (!matchesWatchPaths(application.git.watchPaths ?? [], event.changedPaths)) {
    return { accepted: false, reason: 'Push does not touch the paths watched by this application' };
  }

  const deployment = await enqueueDeployment({
    application,
    trigger: 'webhook',
    branch: event.branch,
    commit: event.commitSha,
  });

  logInfo('Deployment queued from webhook', {
    application: String(application._id),
    deployment: String(deployment._id),
    commit: event.commitSha,
  });

  return {
    accepted: true,
    deploymentId: String(deployment._id),
    commit: event.commitSha,
  };
};
