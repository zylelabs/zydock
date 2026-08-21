import config from '../../config';
import type { AuthPayload } from '../auth/auth.middleware';
import { isSuperuser } from '../users/user.service';
import { findMembership } from '../organizations/membership.service';
import { classifyLine, filterLogs, type ClassifiedLog } from '../logs/log.filter';
import type { LogsQuery } from '../logs/logs.schema';
import { notifyDeploymentEvent } from '../notifications/notification.service';
import type { DeploymentNotificationEvent } from '../notifications/notification.schema';
import { logError } from '../../utils/logger';
import { publish, registerTopicAuthorizer } from '../websocket/websocket.service';
import deploymentModel from './deployment.model';
import type { DeploymentStep, DeploymentStepStatus, DeploymentTrigger } from './deployment.schema';

const topicOf = (deploymentId: string) => `deployment:${deploymentId}:steps`;

const notify = (deploymentId: string, event: DeploymentNotificationEvent) =>
  notifyDeploymentEvent(deploymentId, event).catch(error =>
    logError('Failed to emit a deployment notification', error, {
      deployment: deploymentId,
      event,
    }),
  );

export const findDeployment = (organizationId: string, deploymentId: string) =>
  deploymentModel.findOne({ _id: deploymentId, organizationId });

export const createDeployment = (params: {
  organizationId: string;
  applicationId: string;
  serverId: string;
  branch: string;
  trigger: DeploymentTrigger;
  triggeredBy?: string;
  commit?: string;
  commitDetail?: DeploymentCommit;
  imageTag?: string;
  compose?: DeploymentCompose;
}) =>
  deploymentModel.create({
    organizationId: params.organizationId,
    applicationId: params.applicationId,
    serverId: params.serverId,
    status: 'queued',
    trigger: params.trigger,
    triggeredBy: params.triggeredBy,
    branch: params.branch,
    commit: params.commitDetail ?? (params.commit ? { sha: params.commit } : undefined),
    imageTag: params.imageTag,
    compose: params.compose,
    steps: [],
    log: [],
  });

export const setComposeContent = (deploymentId: string, compose: DeploymentCompose) =>
  deploymentModel.updateOne({ _id: deploymentId }, { $set: { compose } });

export const markRunning = async (deploymentId: string) => {
  await deploymentModel.updateOne(
    { _id: deploymentId },
    { $set: { status: 'running', startedAt: new Date() } },
  );

  publish(topicOf(deploymentId), 'status', { deploymentId, status: 'running' });

  await notify(deploymentId, 'deployment.started');
};

export const recordStep = async (
  deploymentId: string,
  result: {
    step: DeploymentStep;
    status: DeploymentStepStatus;
    detail?: string;
    durationMs: number;
  },
) => {
  await deploymentModel.updateOne({ _id: deploymentId }, { $push: { steps: result } });

  publish(topicOf(deploymentId), 'step', { deploymentId, ...result });
};

export const appendLog = async (deploymentId: string, lines: string[]) => {
  if (!lines.length) {
    return;
  }

  await deploymentModel.updateOne(
    { _id: deploymentId },
    { $push: { log: { $each: lines, $slice: -config.deploy.logLines } } },
  );

  publish(topicOf(deploymentId), 'log', { deploymentId, lines });
};

export const finishDeployment = async (
  deploymentId: string,
  outcome: {
    status: 'succeeded' | 'failed';
    error?: string;
    imageTag?: string;
    containerId?: string;
    commit?: DeploymentCommit;
  },
) => {
  const deployment = await deploymentModel.findById(deploymentId);
  const startedAt = deployment?.startedAt ?? deployment?.createdAt ?? new Date();
  const finishedAt = new Date();

  await deploymentModel.updateOne(
    { _id: deploymentId },
    {
      $set: {
        status: outcome.status,
        error: outcome.error,
        finishedAt,
        durationMs: finishedAt.getTime() - new Date(startedAt).getTime(),
        ...(outcome.imageTag ? { imageTag: outcome.imageTag } : {}),
        ...(outcome.containerId ? { containerId: outcome.containerId } : {}),
        ...(outcome.commit ? { commit: outcome.commit } : {}),
      },
    },
  );

  publish(topicOf(deploymentId), 'status', { deploymentId, status: outcome.status });

  await notify(
    deploymentId,
    outcome.status === 'succeeded' ? 'deployment.succeeded' : 'deployment.failed',
  );
};

export const setCommit = (deploymentId: string, commit: DeploymentCommit) =>
  deploymentModel.updateOne({ _id: deploymentId }, { $set: { commit } });

export const removeDeploymentsOfApplications = (applicationIds: string[]) =>
  deploymentModel.deleteMany({ applicationId: { $in: applicationIds } });

const authorizeDeploymentTopic = async (auth: AuthPayload, deploymentId: string) => {
  const deployment = await deploymentModel.findById(deploymentId);

  if (!deployment) {
    return false;
  }

  if (await isSuperuser(auth.email)) {
    return true;
  }

  return Boolean(await findMembership(String(deployment.organizationId), auth.sub));
};

registerTopicAuthorizer('deployment', authorizeDeploymentTopic);

export const serializeDeployment = (deployment: Deployment) => ({
  id: String(deployment._id),
  applicationId: String(deployment.applicationId),
  serverId: String(deployment.serverId),
  status: deployment.status,
  trigger: deployment.trigger,
  branch: deployment.branch,
  commit: deployment.commit?.sha ? deployment.commit : undefined,
  imageTag: deployment.imageTag,
  containerId: deployment.containerId,
  steps: deployment.steps,
  startedAt: deployment.startedAt,
  finishedAt: deployment.finishedAt,
  durationMs: deployment.durationMs,
  error: deployment.error,
  createdAt: deployment.createdAt,
});

export const serializeDeploymentDetail = (deployment: Deployment) => ({
  ...serializeDeployment(deployment),
  log: deployment.log,
});

export const logEntries = (deployment: Deployment, query: LogsQuery): ClassifiedLog[] =>
  filterLogs(deployment.log.slice(-query.tail).map(classifyLine), query);
