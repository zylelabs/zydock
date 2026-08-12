import config from '../../config';
import { resolveContainerProvider } from '../../providers/container';
import { errorMessage } from '../../utils';
import { createAgentClient } from '../../utils/agent';
import { logError } from '../../utils/logger';
import applicationModel from '../applications/application.model';
import deploymentModel from '../deployments/deployment.model';
import { APPLICATION_LABEL, composeContainerNameOf } from '../deployments/naming';
import { buildAgentConnection, findServerById } from '../servers/server.service';
import { publish, registerTopicListener, type TopicEvent } from '../websocket/websocket.service';
import metricModel from './metric.model';

const CHANNEL = 'metrics';

export type SystemMetrics = {
  cpuPercent?: number;
  memoryUsedMb: number;
  memoryTotalMb: number;
  diskUsedGb?: number;
  diskTotalGb?: number;
  networkRxBytes?: number;
  networkTxBytes?: number;
  uptimeSeconds: number;
  containersRunning: number;
  containersTotal: number;
};

type ContainerMetrics = {
  id: string;
  name: string;
  cpuPercent: number;
  memoryUsedMb: number;
  memoryLimitMb: number;
};

export type ApplicationMetrics = {
  containerId: string;
  name: string;
  state: string;
  health: string;
  restartCount: number;
  uptimeSeconds?: number;
  cpuPercent: number;
  memoryUsedMb: number;
  memoryLimitMb: number;
} | null;

const agentClientFor = (server: Server) => createAgentClient(buildAgentConnection(server));

export const fetchServerMetrics = (server: Server) =>
  agentClientFor(server).json<SystemMetrics>('/metrics');

export const fetchServerContainerMetrics = (server: Server) =>
  agentClientFor(server).json<ContainerMetrics[]>('/metrics/containers');

export const fetchApplicationMetrics = async (
  application: Application,
  server: Server,
  service?: string,
): Promise<ApplicationMetrics> => {
  const containers = resolveContainerProvider(buildAgentConnection(server));

  const list = await containers.listContainers({
    labels: { [APPLICATION_LABEL]: String(application._id) },
  });

  const targetName =
    application.source === 'compose' && application.compose
      ? composeContainerNameOf(application.slug, service ?? application.compose.expose.service)
      : undefined;

  const container = (targetName ? list.find(entry => entry.name === targetName) : list[0]) ?? null;

  if (!container) {
    return null;
  }

  const stats = await agentClientFor(server).json<ContainerMetrics[]>('/metrics/containers');
  const stat = stats.find(
    entry => container.id.startsWith(entry.id) || entry.name === container.name,
  );

  const startedAt = container.startedAt ? Date.parse(container.startedAt) : NaN;

  return {
    containerId: container.id,
    name: container.name,
    state: container.state,
    health: container.health,
    restartCount: container.restartCount,
    uptimeSeconds: Number.isNaN(startedAt)
      ? undefined
      : Math.round((Date.now() - startedAt) / 1000),
    cpuPercent: stat?.cpuPercent ?? 0,
    memoryUsedMb: stat?.memoryUsedMb ?? 0,
    memoryLimitMb: stat?.memoryLimitMb ?? 0,
  };
};

const serializeSample = (sample: MetricSample) => ({
  capturedAt: sample.capturedAt,
  cpuPercent: sample.cpuPercent,
  memoryUsedMb: sample.memoryUsedMb,
  memoryTotalMb: sample.memoryTotalMb,
  diskUsedGb: sample.diskUsedGb,
  diskTotalGb: sample.diskTotalGb,
  networkRxBytes: sample.networkRxBytes,
  networkTxBytes: sample.networkTxBytes,
  containersRunning: sample.containersRunning,
  containersTotal: sample.containersTotal,
});

export const recordServerMetrics = async (serverId: string, metrics: Partial<SystemMetrics>) => {
  await metricModel
    .create({ serverId, capturedAt: new Date(), ...metrics })
    .catch(error => logError('Failed to record a metric sample', error, { server: serverId }));
};

export const serverMetricsHistory = async (
  serverId: string,
  query: { since?: Date; limit: number },
) => {
  const samples = await metricModel
    .find({ serverId, ...(query.since ? { capturedAt: { $gte: query.since } } : {}) })
    .sort({ capturedAt: -1 })
    .limit(query.limit);

  return samples.map(serializeSample);
};

const DEPLOY_WINDOW = 100;

const average = (values: number[]) =>
  values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;

export const deploymentMetrics = async (applicationId: string) => {
  const deployments = await deploymentModel
    .find({ applicationId })
    .sort({ createdAt: -1 })
    .limit(DEPLOY_WINDOW);

  const succeeded = deployments.filter(deployment => deployment.status === 'succeeded');
  const failed = deployments.filter(deployment => deployment.status === 'failed');

  const durations = succeeded
    .map(deployment => deployment.durationMs)
    .filter((value): value is number => typeof value === 'number');

  const buildDurations = deployments
    .map(deployment => deployment.steps.find(step => step.step === 'build')?.durationMs)
    .filter((value): value is number => typeof value === 'number');

  const latest = deployments[0];

  return {
    window: deployments.length,
    succeeded: succeeded.length,
    failed: failed.length,
    successRate: deployments.length
      ? Math.round((succeeded.length / deployments.length) * 100)
      : null,
    averageDurationMs: average(durations),
    averageBuildMs: average(buildDurations),
    last: latest
      ? {
          id: String(latest._id),
          status: latest.status,
          durationMs: latest.durationMs,
          createdAt: latest.createdAt,
          finishedAt: latest.finishedAt,
        }
      : null,
  };
};

const streams = new Map<string, ReturnType<typeof setInterval>>();

const startStream = (topic: string, produce: () => Promise<unknown>) => {
  if (streams.has(topic)) {
    return;
  }

  const tick = async () => {
    try {
      publish(topic, 'metrics', await produce());
    } catch (error) {
      publish(topic, 'error', { reason: errorMessage(error) });
    }
  };

  void tick();
  streams.set(
    topic,
    setInterval(() => void tick(), config.metrics.streamIntervalSeconds * 1000),
  );
};

const stopStream = (topic: string) => {
  const timer = streams.get(topic);

  if (timer) {
    clearInterval(timer);
    streams.delete(topic);
  }
};

const produceServerMetrics = async (serverId: string) => {
  const server = await findServerById(serverId);

  if (!server?.agent.token) {
    throw new Error('This server has no agent yet');
  }

  return fetchServerMetrics(server);
};

const produceApplicationMetrics = async (applicationId: string) => {
  const application = await applicationModel.findById(applicationId);

  if (!application) {
    throw new Error('Application not found');
  }

  const server = await findServerById(String(application.serverId));

  if (!server?.agent.token) {
    throw new Error('This server has no agent yet');
  }

  return fetchApplicationMetrics(application, server);
};

const listenerFor = (produce: (resourceId: string) => Promise<unknown>) => ({
  subscribed: (event: TopicEvent) => {
    if (event.channel === CHANNEL) {
      startStream(event.topic, () => produce(event.resourceId));
    }
  },
  unsubscribed: (event: TopicEvent) => {
    if (event.channel === CHANNEL && event.subscribers === 0) {
      stopStream(event.topic);
    }
  },
});

registerTopicListener('server', listenerFor(produceServerMetrics));
registerTopicListener('application', listenerFor(produceApplicationMetrics));

export const stopMetricStreams = () => {
  for (const topic of [...streams.keys()]) {
    stopStream(topic);
  }
};
