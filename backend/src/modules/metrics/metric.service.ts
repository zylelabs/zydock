import { Types } from 'mongoose';
import config from '../../config';
import { resolveContainerProvider } from '../../providers/container';
import { errorMessage } from '../../utils';
import { createAgentClient, searchParams } from '../../utils/agent';
import { createTtlCache } from '../../utils/cache';
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

  const stats = await agentClientFor(server).json<ContainerMetrics[]>('/metrics/containers', {
    query: searchParams({ id: container.id }),
  });
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
    .limit(query.limit)
    .lean();

  return samples.map(serializeSample);
};

const DEPLOY_WINDOW = 100;

type DeploymentMetricsRow = {
  window: number;
  succeeded: number;
  failed: number;
  avgDurationMs: number | null;
  avgBuildMs: number | null;
  latest: {
    id: Types.ObjectId;
    status: Deployment['status'];
    durationMs?: number;
    createdAt: Date;
    finishedAt?: Date;
  };
};

export const deploymentMetrics = async (applicationId: string) => {
  const [result] = await deploymentModel.aggregate<DeploymentMetricsRow>([
    { $match: { applicationId: new Types.ObjectId(applicationId) } },
    { $sort: { createdAt: -1 } },
    { $limit: DEPLOY_WINDOW },
    {
      $addFields: {
        buildDurationMs: {
          $getField: {
            field: 'durationMs',
            input: {
              $first: { $filter: { input: '$steps', cond: { $eq: ['$$this.step', 'build'] } } },
            },
          },
        },
      },
    },
    {
      $group: {
        _id: null,
        window: { $sum: 1 },
        succeeded: { $sum: { $cond: [{ $eq: ['$status', 'succeeded'] }, 1, 0] } },
        failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
        avgDurationMs: {
          $avg: { $cond: [{ $eq: ['$status', 'succeeded'] }, '$durationMs', null] },
        },
        avgBuildMs: { $avg: '$buildDurationMs' },
        latest: {
          $first: {
            id: '$_id',
            status: '$status',
            durationMs: '$durationMs',
            createdAt: '$createdAt',
            finishedAt: '$finishedAt',
          },
        },
      },
    },
  ]);

  if (!result) {
    return {
      window: 0,
      succeeded: 0,
      failed: 0,
      successRate: null,
      averageDurationMs: null,
      averageBuildMs: null,
      last: null,
    };
  }

  return {
    window: result.window,
    succeeded: result.succeeded,
    failed: result.failed,
    successRate: result.window ? Math.round((result.succeeded / result.window) * 100) : null,
    averageDurationMs: result.avgDurationMs === null ? null : Math.round(result.avgDurationMs),
    averageBuildMs: result.avgBuildMs === null ? null : Math.round(result.avgBuildMs),
    last: {
      id: String(result.latest.id),
      status: result.latest.status,
      durationMs: result.latest.durationMs,
      createdAt: result.latest.createdAt,
      finishedAt: result.latest.finishedAt,
    },
  };
};

type StreamState = {
  timer: ReturnType<typeof setTimeout>;
  failures: number;
};

const streams = new Map<string, StreamState>();

const startStream = (topic: string, produce: () => Promise<unknown>) => {
  if (streams.has(topic)) {
    return;
  }

  const baseIntervalMs = config.metrics.streamIntervalSeconds * 1000;
  const maxIntervalMs = config.metrics.streamMaxIntervalSeconds * 1000;

  const tick = async () => {
    const state = streams.get(topic);

    if (!state) {
      return;
    }

    try {
      publish(topic, 'metrics', await produce());
      state.failures = 0;
    } catch (error) {
      publish(topic, 'error', { reason: errorMessage(error) });
      state.failures += 1;
    }

    const delayMs = state.failures
      ? Math.min(baseIntervalMs * 2 ** state.failures, maxIntervalMs)
      : baseIntervalMs;

    state.timer = setTimeout(() => void tick(), delayMs);
  };

  streams.set(topic, { timer: setTimeout(() => void tick(), 0), failures: 0 });
};

const stopStream = (topic: string) => {
  const state = streams.get(topic);

  if (state) {
    clearTimeout(state.timer);
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

type ApplicationStreamTarget = { application: Application; server: Server };

const applicationTargetCaches = new Map<
  string,
  ReturnType<typeof createTtlCache<ApplicationStreamTarget>>
>();

const resolveApplicationTarget = (applicationId: string) => {
  let cache = applicationTargetCaches.get(applicationId);

  if (!cache) {
    cache = createTtlCache<ApplicationStreamTarget>(config.metrics.resolutionCacheTtlSeconds);
    applicationTargetCaches.set(applicationId, cache);
  }

  return cache.resolve(async () => {
    const application = await applicationModel.findById(applicationId);

    if (!application) {
      throw new Error('Application not found');
    }

    const server = await findServerById(String(application.serverId));

    if (!server?.agent.token) {
      throw new Error('This server has no agent yet');
    }

    return { application, server };
  });
};

const produceApplicationMetrics = async (applicationId: string) => {
  const { application, server } = await resolveApplicationTarget(applicationId);

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
