import config from '../../config';
import { resolveContainerProvider, type ContainerSpec } from '../../providers/container';
import { resolveGitProvider } from '../../providers/git';
import { createAgentClient, type AgentConnection } from '../../utils/agent';
import { logError, logInfo } from '../../utils/logger';
import applicationModel from '../applications/application.model';
import {
  decryptVariables,
  findApplicationWithSecrets,
  resolveGitCredentials,
} from '../applications/application.service';
import { enqueueJob, registerJobHandler } from '../queue/queue.service';
import { buildAgentConnection, findServerById } from '../servers/server.service';
import { applyApplicationDomains } from '../domains/domain.service';
import deploymentModel from './deployment.model';
import type { DeploymentStep } from './deployment.schema';
import { APPLICATION_LABEL, AUTOHEAL_LABEL, containerNameOf, DEPLOYMENT_LABEL } from './naming';
import {
  appendBuildLog,
  createDeployment,
  finishDeployment,
  markRunning,
  recordStep,
  setCommit,
} from './deployment.service';

export const DEPLOY_JOB = 'deployment.run';

const HEALTHCHECK_POLL_MS = 2000;

type CloneResult = {
  workspace: string;
  path: string;
  commit: string;
  message: string;
  author: string;
  committedAt: string;
};

const imageTagOf = (slug: string, commit: string) => `zydock/${slug}:${commit.slice(0, 7)}`;

const environmentOf = (application: Application) =>
  Object.fromEntries(
    decryptVariables(application.variables).map(variable => [variable.key, variable.value]),
  );

const healthcheckCommandOf = (application: Application) => {
  const url = `http://127.0.0.1:${application.port}${application.healthcheck?.path}`;

  return [`wget -q -O /dev/null ${url} || curl -fsS ${url} || exit 1`];
};

const specOf = (application: Application, deploymentId: string, image: string): ContainerSpec => ({
  name: containerNameOf(application.slug),
  image,
  environment: environmentOf(application),
  ports: [
    { containerPort: application.port, protocol: 'tcp' as const },
    ...application.portMappings.map(mapping => ({
      containerPort: mapping.containerPort,
      hostPort: mapping.hostPort,
      protocol: mapping.protocol,
    })),
  ],
  volumes: application.volumes,
  networks: [...new Set([config.proxy.network, ...application.networks])],
  labels: {
    [APPLICATION_LABEL]: String(application._id),
    [DEPLOYMENT_LABEL]: deploymentId,
    ...(application.restartPolicy !== 'no' ? { [AUTOHEAL_LABEL]: 'true' } : {}),
  },
  restartPolicy: application.restartPolicy,
  ...(application.healthcheck?.path
    ? {
        healthcheck: {
          command: healthcheckCommandOf(application),
          intervalSeconds: application.healthcheck.intervalSeconds,
          timeoutSeconds: application.healthcheck.timeoutSeconds,
          retries: application.healthcheck.retries,
          startPeriodSeconds: application.healthcheck.startPeriodSeconds,
        },
      }
    : {}),
  ...(application.resources ? { resources: application.resources } : {}),
});

const cloneStep = async (
  connection: AgentConnection,
  application: Application,
  deploymentId: string,
  branch: string,
  commit?: string,
) => {
  const git = resolveGitProvider(await resolveGitCredentials(application));

  const url = await git.getCloneUrl(application.git.repository);

  const { json } = createAgentClient(connection);

  return json<CloneResult>('/repositories/clone', {
    method: 'POST',
    body: { url, branch, workspace: deploymentId, commit },
  });
};

const replaceContainer = async (
  connection: AgentConnection,
  application: Application,
  deploymentId: string,
  image: string,
) => {
  const containers = resolveContainerProvider(connection);

  await containers.createNetwork(config.proxy.network);

  const previous = await containers.listContainers({
    labels: { [APPLICATION_LABEL]: String(application._id) },
  });

  for (const container of previous) {
    await containers.removeContainer(container.id, false);
  }

  const created = await containers.createContainer(specOf(application, deploymentId, image));

  await containers.startContainer(created.id);

  return created;
};

const healthcheckStep = async (
  connection: AgentConnection,
  containerId: string,
  expectsHealth: boolean,
) => {
  const containers = resolveContainerProvider(connection);
  const deadline = Date.now() + config.deploy.healthcheckTimeoutSeconds * 1000;

  let last = 'unknown';

  while (Date.now() < deadline) {
    const container = await containers.inspectContainer(containerId);

    if (!container) {
      throw new Error('The container disappeared while waiting for it to become healthy');
    }

    last = expectsHealth ? `${container.state}/${container.health}` : container.state;

    if (container.state === 'exited' || container.state === 'dead') {
      throw new Error(`The container stopped right after starting (state: ${container.state})`);
    }

    if (container.state === 'running' && (!expectsHealth || container.health === 'healthy')) {
      return last;
    }

    await Bun.sleep(HEALTHCHECK_POLL_MS);
  }

  throw new Error(`The container did not become healthy in time (last state: ${last})`);
};

export const runDeployment = async (deploymentId: string) => {
  const deployment = await deploymentModel.findById(deploymentId);

  if (!deployment) {
    throw new Error(`Deployment ${deploymentId} not found`);
  }

  const application = await findApplicationWithSecrets(
    String(deployment.organizationId),
    String(deployment.applicationId),
  );

  if (!application) {
    await finishDeployment(deploymentId, { status: 'failed', error: 'Application not found' });
    return;
  }

  const server = await findServerById(String(deployment.serverId));

  if (!server) {
    await finishDeployment(deploymentId, { status: 'failed', error: 'Server not found' });
    return;
  }

  let currentStep: DeploymentStep = 'clone';
  let stepStartedAt = Date.now();
  let workspace: string | undefined;
  let connection: AgentConnection | undefined;

  const startStep = (step: DeploymentStep) => {
    currentStep = step;
    stepStartedAt = Date.now();
  };

  const finishStep = (detail?: string, status: 'ok' | 'skipped' = 'ok') =>
    recordStep(deploymentId, {
      step: currentStep,
      status,
      detail,
      durationMs: Date.now() - stepStartedAt,
    });

  try {
    await markRunning(deploymentId);
    await applicationModel.updateOne({ _id: application._id }, { $set: { status: 'deploying' } });

    connection = buildAgentConnection(server);

    const isRollback = deployment.trigger === 'rollback';

    let image: string;
    let commit: DeploymentCommit | undefined;

    if (isRollback) {
      if (!deployment.imageTag) {
        throw new Error('This rollback has no target image');
      }

      image = deployment.imageTag;
      commit = deployment.commit;

      startStep('clone');
      await finishStep('Rollback — clone dispensado', 'skipped');

      startStep('build');
      await finishStep(`Reusando a imagem ${image}`, 'skipped');
    } else {
      startStep('clone');

      const clone = await cloneStep(
        connection,
        application,
        deploymentId,
        deployment.branch,
        deployment.commit?.sha,
      );

      workspace = clone.workspace;

      commit = {
        sha: clone.commit,
        message: clone.message,
        author: clone.author,
        committedAt: new Date(clone.committedAt),
      };

      await setCommit(deploymentId, commit);
      await finishStep(`${clone.commit.slice(0, 7)} — ${clone.message}`);

      startStep('build');

      image = imageTagOf(application.slug, clone.commit);
      const containers = resolveContainerProvider(connection);

      let pending: string[] = [];

      const flush = async () => {
        const lines = pending;

        pending = [];

        await appendBuildLog(deploymentId, lines);
      };

      const built = await containers.buildImage({
        tag: image,
        contextPath: `${clone.path}/${application.git.buildContext}`.replace(/\/\.$/, ''),
        dockerfilePath: `${clone.path}/${application.git.dockerfilePath}`,
        onLog: entry => {
          pending.push(entry.message.trimEnd());

          if (pending.length >= 20) {
            void flush();
          }
        },
      });

      await flush();
      await finishStep(`${built.tag} (${Math.round(built.sizeBytes / 1024 / 1024)} MB)`);
    }

    startStep('container');

    const container = await replaceContainer(connection, application, deploymentId, image);

    await finishStep(container.name);

    startStep('proxy');

    const domains = await applyApplicationDomains(application, connection);

    if (domains.length === 0) {
      await finishStep('No domain configured for this application', 'skipped');
    } else {
      await finishStep(domains.map(domain => domain.hostname).join(', '));
    }

    startStep('healthcheck');

    const state = await healthcheckStep(
      connection,
      container.id,
      Boolean(application.healthcheck?.path),
    );

    await finishStep(state);

    await applicationModel.updateOne(
      { _id: application._id },
      { $set: { status: 'running' }, $unset: { lastError: '' } },
    );

    await finishDeployment(deploymentId, {
      status: 'succeeded',
      imageTag: image,
      containerId: container.id,
      commit,
    });

    logInfo('Deployment succeeded', {
      deployment: deploymentId,
      application: String(application._id),
      image,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    await recordStep(deploymentId, {
      step: currentStep,
      status: 'failed',
      detail: message,
      durationMs: Date.now() - stepStartedAt,
    });

    await applicationModel.updateOne(
      { _id: application._id },
      { $set: { status: 'failed', lastError: message } },
    );

    await finishDeployment(deploymentId, { status: 'failed', error: message });

    logError('Deployment failed', error, { deployment: deploymentId, step: currentStep });
  } finally {
    if (connection && workspace) {
      const { discard } = createAgentClient(connection);

      await discard(`/repositories/${workspace}`, { method: 'DELETE' }).catch(cleanupError =>
        logError('Failed to remove the build workspace', cleanupError, { workspace }),
      );
    }
  }
};

registerJobHandler(DEPLOY_JOB, async payload => {
  await runDeployment(String(payload.deploymentId));
});

export const enqueueDeployment = async (params: {
  application: Application;
  trigger: 'manual' | 'webhook';
  triggeredBy?: string;
  branch?: string;
  commit?: string;
}) => {
  const deployment = await createDeployment({
    organizationId: String(params.application.organizationId),
    applicationId: String(params.application._id),
    serverId: String(params.application.serverId),
    branch: params.branch ?? params.application.git.branch,
    trigger: params.trigger,
    triggeredBy: params.triggeredBy,
    commit: params.commit,
  });

  await enqueueJob(DEPLOY_JOB, { deploymentId: String(deployment._id) }, { maxAttempts: 1 });

  return deployment;
};

export const enqueueRollback = async (params: {
  application: Application;
  source: Deployment;
  triggeredBy?: string;
}) => {
  const deployment = await createDeployment({
    organizationId: String(params.application.organizationId),
    applicationId: String(params.application._id),
    serverId: String(params.application.serverId),
    branch: params.source.branch,
    trigger: 'rollback',
    triggeredBy: params.triggeredBy,
    commitDetail: params.source.commit,
    imageTag: params.source.imageTag,
  });

  await enqueueJob(DEPLOY_JOB, { deploymentId: String(deployment._id) }, { maxAttempts: 1 });

  return deployment;
};
