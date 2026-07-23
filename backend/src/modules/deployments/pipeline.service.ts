import config from '../../config';
import { resolveContainerProvider, type ContainerSpec } from '../../providers/container';
import { resolveGitProvider } from '../../providers/git';
import { createAgentClient, type AgentConnection } from '../../utils/agent';
import { logError, logInfo } from '../../utils/logger';
import applicationModel from '../applications/application.model';
import { decryptVariables, findApplicationWithSecrets } from '../applications/application.service';
import { enqueueJob, registerJobHandler } from '../queue/queue.service';
import { buildAgentConnection, findServerById } from '../servers/server.service';
import { decryptSecret } from '../../utils/crypto';
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

/** Docker refuses uppercase in a tag; slugs are already lowercase. */
const imageTagOf = (slug: string, commit: string) => `zydock/${slug}:${commit.slice(0, 7)}`;

const environmentOf = (application: Application) =>
  Object.fromEntries(
    decryptVariables(application.variables).map(variable => [variable.key, variable.value]),
  );

/**
 * The application declares an HTTP path; Docker wants a shell command — and adds the `CMD-SHELL`
 * wrapper itself, so naming it here would turn it into the program to run. `wget` and `curl` cover
 * the usual base images, and the shell picks whichever exists.
 */
const healthcheckCommandOf = (application: Application) => {
  const url = `http://127.0.0.1:${application.port}${application.healthcheck?.path}`;

  return [`wget -q -O /dev/null ${url} || curl -fsS ${url} || exit 1`];
};

const specOf = (application: Application, deploymentId: string, image: string): ContainerSpec => ({
  name: containerNameOf(application.slug),
  image,
  environment: environmentOf(application),
  ports: [{ containerPort: application.port, protocol: 'tcp' }],
  volumes: application.volumes,
  // The shared proxy network is always attached, so a domain can be pointed at the container later
  // without a redeploy; the proxy dials it by the stable container name.
  networks: [...new Set([config.proxy.network, ...application.networks])],
  labels: {
    [APPLICATION_LABEL]: String(application._id),
    [DEPLOYMENT_LABEL]: deploymentId,
    [AUTOHEAL_LABEL]: 'true',
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
  const git = resolveGitProvider({
    host: application.git.host,
    token: application.git.token ? decryptSecret(application.git.token) : '',
  });

  const url = await git.getCloneUrl(application.git.repository);

  const { json } = createAgentClient(connection);

  return json<CloneResult>('/repositories/clone', {
    method: 'POST',
    body: { url, branch, workspace: deploymentId, commit },
  });
};

/** Replaces whatever is running for this application, matching by label and not by name. */
const replaceContainer = async (
  connection: AgentConnection,
  application: Application,
  deploymentId: string,
  image: string,
) => {
  const containers = resolveContainerProvider(connection);

  // The shared proxy network has to exist before a container can join it; creating it is idempotent.
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

    // 1. Clone on the server itself: the build context never travels through the backend.
    startStep('clone');

    const clone = await cloneStep(
      connection,
      application,
      deploymentId,
      deployment.branch,
      deployment.commit?.sha,
    );

    workspace = clone.workspace;

    const commit: DeploymentCommit = {
      sha: clone.commit,
      message: clone.message,
      author: clone.author,
      committedAt: new Date(clone.committedAt),
    };

    await setCommit(deploymentId, commit);
    await finishStep(`${clone.commit.slice(0, 7)} — ${clone.message}`);

    // 2. Build, streaming the output to whoever is watching the deployment.
    startStep('build');

    const image = imageTagOf(application.slug, clone.commit);
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

    // 3. Replace the running container.
    startStep('container');

    const container = await replaceContainer(connection, application, deploymentId, image);

    await finishStep(container.name);

    // 4. Reverse proxy: point every domain of the application at the (stable) container name.
    startStep('proxy');

    const domains = await applyApplicationDomains(application, connection);

    if (domains.length === 0) {
      await finishStep('No domain configured for this application', 'skipped');
    } else {
      await finishStep(domains.map(domain => domain.hostname).join(', '));
    }

    // 5. Wait until the container is actually up.
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
    // The workspace is disposable; keeping it would fill the disk one deploy at a time.
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

/** Creates the deployment and hands it to the queue — the caller never waits for the pipeline. */
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
