import { resolveGitProvider, type GitWebhookRequest } from '../../providers/git';
import { decryptSecret } from '../../utils/crypto';
import { logInfo } from '../../utils/logger';
import applicationModel from '../applications/application.model';
import { matchesWatchPaths } from '../applications/webhook.service';
import { enqueueDeployment } from '../deployments/pipeline.service';

export type GitSourceWebhookOutcome =
  | { accepted: true; queued: number }
  | {
      accepted: false;
      reason: string;
    };

export const handleGitSourcePush = async (
  gitSource: GitSource,
  request: GitWebhookRequest,
): Promise<GitSourceWebhookOutcome> => {
  if (!gitSource.webhookSecret) {
    return { accepted: false, reason: 'This git source has no webhook configured' };
  }

  const git = resolveGitProvider({ host: 'github', token: '' });
  const secret = decryptSecret(gitSource.webhookSecret);

  if (!(await git.verifyWebhook(request, secret))) {
    return { accepted: false, reason: 'Invalid signature' };
  }

  const event = git.parseWebhookEvent(request);

  if (!event) {
    return { accepted: false, reason: 'Not a deployable push event' };
  }

  const applications = await applicationModel.find({
    'git.source': 'github-app',
    'git.gitSourceId': String(gitSource._id),
    'git.repository': event.repositoryFullName,
    'git.branch': event.branch,
    'git.autoDeploy': true,
  });

  if (!applications.length) {
    return { accepted: false, reason: 'No application listens to this repository and branch' };
  }

  const matchingApplications = applications.filter(application =>
    matchesWatchPaths(application.git.watchPaths ?? [], event.changedPaths),
  );

  if (!matchingApplications.length) {
    return {
      accepted: false,
      reason: 'No application watches the paths touched by this push',
    };
  }

  for (const application of matchingApplications) {
    await enqueueDeployment({
      application,
      trigger: 'webhook',
      branch: event.branch,
      commit: event.commitSha,
    });
  }

  logInfo('Deployment(s) queued from git source webhook', {
    gitSource: String(gitSource._id),
    repository: event.repositoryFullName,
    branch: event.branch,
    queued: matchingApplications.length,
    skippedByPath: applications.length - matchingApplications.length,
  });

  return { accepted: true, queued: matchingApplications.length };
};
