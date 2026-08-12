import config from '../../config';
import { resolveComposeProvider, type ComposeServiceStatus } from '../../providers/compose';
import {
  resolveContainerProvider,
  type ContainerSpec,
  type ImageInfo,
} from '../../providers/container';
import { resolveGitProvider } from '../../providers/git';
import {
  createAgentClient,
  isAbortError,
  readAgentEvents,
  type AgentConnection,
} from '../../utils/agent';
import { logError, logInfo } from '../../utils/logger';
import applicationModel from '../applications/application.model';
import {
  decryptVariables,
  findApplicationWithSecrets,
  replaceVariables,
  resolveGitCredentials,
} from '../applications/application.service';
import { validateComposeSecurity } from '../compose/compose.schema';
import {
  maskSecrets,
  parseComposeDocument,
  renderEnvFile,
  secretValuesOf,
} from '../compose/compose.service';
import { renderOverrideDocument } from '../compose/override.service';
import { applyApplicationDomains } from '../domains/domain.service';
import { enqueueJob, registerJobHandler } from '../queue/queue.service';
import { buildAgentConnection, findServerById } from '../servers/server.service';
import { parseEnvContent } from '../templates/render.service';
import deploymentModel from './deployment.model';
import type { DeploymentStep } from './deployment.schema';
import {
  APPLICATION_LABEL,
  AUTOHEAL_LABEL,
  composeContainerNameOf,
  composeProjectOf,
  containerNameOf,
  DEPLOYMENT_LABEL,
} from './naming';
import {
  appendLog,
  createDeployment,
  finishDeployment,
  markRunning,
  recordStep,
  setCommit,
  setComposeContent,
} from './deployment.service';

export const DEPLOY_JOB = 'deployment.run';

const HEALTHCHECK_POLL_MS = 2000;
const LOG_FLUSH_DELAY_MS = 75;

const makeLogPublisher = (deploymentId: string, step: DeploymentStep) => {
  let pending: string[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    timer = null;

    if (!pending.length) {
      return;
    }

    const lines = pending;

    pending = [];

    void appendLog(deploymentId, lines);
  };

  const push = (message: string) => {
    pending.push(`[${step}] ${message.trimEnd()}`);

    if (!timer) {
      timer = setTimeout(flush, LOG_FLUSH_DELAY_MS);
    }
  };

  const drain = () => {
    if (timer) {
      clearTimeout(timer);
    }

    flush();
  };

  return { push, drain };
};

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
    { containerPort: application.port!, protocol: 'tcp' as const },
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
  commit: string | undefined,
  onLog: (message: string) => void,
) => {
  const git = resolveGitProvider(await resolveGitCredentials(application));

  const url = await git.getCloneUrl(application.git.repository!);

  const { send } = createAgentClient(connection);

  const response = await send('/repositories/clone', {
    method: 'POST',
    body: { url, branch, workspace: deploymentId, commit },
    streamed: true,
  });

  let result: CloneResult | null = null;
  let failure: string | null = null;

  for await (const entry of readAgentEvents(response)) {
    if (entry.event === 'log') {
      onLog((JSON.parse(entry.data) as { message: string }).message);
    } else if (entry.event === 'result') {
      result = JSON.parse(entry.data) as CloneResult;
    } else if (entry.event === 'error') {
      failure = (JSON.parse(entry.data) as { error: string }).error;
    }
  }

  if (failure) {
    throw new Error(`Failed to clone the repository: ${failure}`);
  }

  if (!result) {
    throw new Error('The agent closed the clone stream without a result');
  }

  return result;
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

  const removed = new Set<string>();

  for (const container of previous) {
    await containers.removeContainer(container.id, false);
    removed.add(container.id);
  }

  const conflicting = await containers.inspectContainer(containerNameOf(application.slug));

  if (conflicting && !removed.has(conflicting.id)) {
    await containers.removeContainer(conflicting.id, false);
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

const renderComposeStep = async (
  connection: AgentConnection,
  application: Application,
  deploymentId: string,
  isRollback: boolean,
  rollbackCompose: DeploymentCompose | undefined,
  secretValues: string[],
) => {
  if (!application.compose) {
    throw new Error('This application has no compose file configured');
  }

  let content: string;
  let envContent: string;

  if (isRollback) {
    if (!rollbackCompose) {
      throw new Error('This rollback has no compose snapshot to reapply');
    }

    content = rollbackCompose.content;
    envContent = rollbackCompose.envContent;
  } else {
    content = application.compose.content;
    envContent = renderEnvFile(application);

    await setComposeContent(deploymentId, { content, envContent });
  }

  const parsed = parseComposeDocument(content);

  validateComposeSecurity(parsed);

  const overrideContent = renderOverrideDocument(parsed.services, application, deploymentId);
  const project = composeProjectOf(application.slug);

  const compose = resolveComposeProvider(connection);

  await compose.writeFiles(project, [
    { name: 'docker-compose.yml', content },
    { name: 'zydock.override.yml', content: overrideContent },
    { name: '.env', content: envContent },
  ]);

  const result = await compose.config(project);

  if (!result.valid) {
    throw new Error(maskSecrets(result.error || 'Invalid compose project', secretValues));
  }

  validateComposeSecurity(parseComposeDocument(result.output));

  return { project, services: parsed.services.map(service => service.name) };
};

const composeStatusSummary = (rows: ComposeServiceStatus[]) => {
  const notRunning = rows.filter(row => row.state !== 'running');

  return notRunning.length === 0
    ? `${rows.length}/${rows.length} services running`
    : `${rows.length - notRunning.length}/${rows.length} services running (${notRunning
        .map(row => `${row.service}: ${row.state}`)
        .join(', ')})`;
};

export const runDeployment = async (deploymentId: string) => {
  const deployment = await deploymentModel.findById(deploymentId).select('+compose.envContent');

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

  let currentStep: DeploymentStep = application.source === 'compose' ? 'render' : 'clone';
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

    let containerId: string;
    let finalImageTag: string | undefined;
    let finalCommit: DeploymentCommit | undefined;

    if (application.source === 'compose') {
      const secretValues = secretValuesOf(application);

      startStep('render');

      const { project, services } = await renderComposeStep(
        connection,
        application,
        deploymentId,
        isRollback,
        deployment.compose,
        secretValues,
      );

      await finishStep(`${services.length} service(s) rendered`);

      startStep('pull');

      const pullLog = makeLogPublisher(deploymentId, 'pull');
      const compose = resolveComposeProvider(connection);

      try {
        await compose.pull(project, entry =>
          pullLog.push(maskSecrets(entry.message, secretValues)),
        );
      } finally {
        pullLog.drain();
      }

      await finishStep();

      startStep('container');

      const upLog = makeLogPublisher(deploymentId, 'container');

      try {
        await compose.up(project, entry => upLog.push(maskSecrets(entry.message, secretValues)));
      } finally {
        upLog.drain();
      }

      const rows = await compose.ps(project);

      await finishStep(composeStatusSummary(rows));

      containerId = composeContainerNameOf(application.slug, application.compose!.expose.service);

      const exposedRow = rows.find(row => row.service === application.compose!.expose.service);

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
        containerId,
        Boolean(exposedRow?.health && exposedRow.health !== 'none'),
      );

      await finishStep(state);
    } else {
      const containers = resolveContainerProvider(connection);

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

        const cloneLog = makeLogPublisher(deploymentId, 'clone');

        let clone: CloneResult;

        try {
          clone = await cloneStep(
            connection,
            application,
            deploymentId,
            deployment.branch,
            deployment.commit?.sha,
            message => cloneLog.push(message),
          );
        } finally {
          cloneLog.drain();
        }

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

        const buildLog = makeLogPublisher(deploymentId, 'build');

        let built: ImageInfo;

        try {
          built = await containers.buildImage({
            tag: image,
            contextPath: `${clone.path}/${application.git.buildContext}`.replace(/\/\.$/, ''),
            dockerfilePath: `${clone.path}/${application.git.dockerfilePath}`,
            onLog: entry => buildLog.push(entry.message),
          });
        } finally {
          buildLog.drain();
        }

        await finishStep(`${built.tag} (${Math.round(built.sizeBytes / 1024 / 1024)} MB)`);
      }

      startStep('container');

      const container = await replaceContainer(connection, application, deploymentId, image);

      await finishStep(container.name);

      containerId = container.id;
      finalImageTag = image;
      finalCommit = commit;

      const containerLog = makeLogPublisher(deploymentId, 'container');
      const bootLogsAbort = new AbortController();

      const consumeBootLogs = async () => {
        try {
          for await (const entry of containers.streamLogs(container.id, {
            signal: bootLogsAbort.signal,
          })) {
            containerLog.push(entry.message);
          }
        } catch (error) {
          if (!isAbortError(error)) {
            logError('Failed to stream container boot logs', error, { deployment: deploymentId });
          }
        } finally {
          containerLog.drain();
        }
      };

      const bootLogsPromise = consumeBootLogs();

      try {
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
      } finally {
        bootLogsAbort.abort();
        await bootLogsPromise;
      }
    }

    await applicationModel.updateOne(
      { _id: application._id },
      { $set: { status: 'running' }, $unset: { lastError: '' } },
    );

    if (
      application.source === 'compose' &&
      isRollback &&
      deployment.compose?.envContent !== undefined
    ) {
      const rollbackVariables = parseEnvContent(deployment.compose.envContent).map(
        ({ key, value }) => ({
          key,
          value,
          secret: application.variables.find(candidate => candidate.key === key)?.secret ?? false,
        }),
      );

      await replaceVariables(String(application._id), rollbackVariables);
    }

    await finishDeployment(deploymentId, {
      status: 'succeeded',
      imageTag: finalImageTag,
      containerId,
      commit: finalCommit,
    });

    logInfo('Deployment succeeded', {
      deployment: deploymentId,
      application: String(application._id),
    });
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    const message =
      application.source === 'compose'
        ? maskSecrets(rawMessage, secretValuesOf(application))
        : rawMessage;

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
    branch:
      params.branch ?? (params.application.source === 'git' ? params.application.git.branch : ''),
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
  let compose: DeploymentCompose | undefined;

  if (params.application.source === 'compose') {
    const withSecrets = await deploymentModel
      .findById(params.source._id)
      .select('+compose.envContent');

    if (withSecrets?.compose?.content && withSecrets.compose.envContent !== undefined) {
      compose = {
        content: withSecrets.compose.content,
        envContent: withSecrets.compose.envContent,
      };
    }
  }

  const deployment = await createDeployment({
    organizationId: String(params.application.organizationId),
    applicationId: String(params.application._id),
    serverId: String(params.application.serverId),
    branch: params.source.branch,
    trigger: 'rollback',
    triggeredBy: params.triggeredBy,
    commitDetail: params.source.commit,
    imageTag: params.source.imageTag,
    compose,
  });

  await enqueueJob(DEPLOY_JOB, { deploymentId: String(deployment._id) }, { maxAttempts: 1 });

  return deployment;
};
