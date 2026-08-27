import config from '../../config';
import type { ContainerInfo, RestartPolicy } from '../../providers/container/container.contract';
import { resolveContainerProvider } from '../../providers/container';
import { logError, logInfo, logWarn } from '../../utils/logger';
import { isProtectedContainer } from '../containers/protection.service';

export const AUTOHEAL_LABEL = 'zydock.autoheal';

const APPLICATION_LABEL = 'zydock.application';

const DATABASE_LABEL = 'zydock.database';

let timer: ReturnType<typeof setInterval> | undefined;

let restarts = 0;

export const getRestartCount = () => restarts;

const manuallyStopped = new Set<string>();

export const markManuallyStopped = (containerId: string) => {
  manuallyStopped.add(containerId);
};

export const clearManualStop = (containerId: string) => {
  manuallyStopped.delete(containerId);
};

const fetchApplicationStatus = async (applicationId: string) => {
  try {
    const response = await fetch(
      `${config.backendUrl}/api/agent/applications/${applicationId}/status`,
      { headers: { 'X-Agent-Token': config.agentToken } },
    );

    if (!response.ok) {
      return undefined;
    }

    const body = (await response.json()) as { status?: string };

    return body.status;
  } catch (error) {
    logWarn('Failed to check application status before auto-heal', {
      applicationId,
      error: error instanceof Error ? error.message : String(error),
    });

    return undefined;
  }
};

const needsHealing = async (container: ContainerInfo) => {
  const isDown =
    container.state === 'exited' || container.state === 'dead' || container.health === 'unhealthy';

  if (!isDown) {
    return false;
  }

  const applicationId = container.labels[APPLICATION_LABEL];

  if (!applicationId) {
    return !manuallyStopped.has(container.id);
  }

  const status = await fetchApplicationStatus(applicationId);

  return status !== undefined && status !== 'stopped';
};

export const runHealthSweep = async () => {
  const containers = resolveContainerProvider();

  const watched = await containers.listContainers({ labels: { [AUTOHEAL_LABEL]: 'true' } });

  const healed: string[] = [];

  for (const container of watched) {
    if (isProtectedContainer(container)) {
      logWarn('Auto-heal skipped a protected container', { container: container.name });
      continue;
    }

    if (!(await needsHealing(container))) {
      continue;
    }

    try {
      await containers.restartContainer(container.id);

      restarts += 1;
      healed.push(container.name);

      logInfo('Container restarted by auto-heal', {
        container: container.name,
        state: container.state,
        health: container.health,
      });
    } catch (error) {
      logError('Auto-heal failed to restart container', error, { container: container.name });
    }
  }

  return healed;
};

const isManagedContainer = (container: ContainerInfo) =>
  container.labels[APPLICATION_LABEL] !== undefined ||
  container.labels[DATABASE_LABEL] !== undefined;

const listManagedContainers = async () => {
  const containers = resolveContainerProvider();
  const all = await containers.listContainers();

  return all.filter(isManagedContainer).filter(container => !isProtectedContainer(container));
};

export const runStandbySweep = async () => {
  const containers = resolveContainerProvider();
  const managed = await listManagedContainers();

  for (const container of managed) {
    if (container.state !== 'running') {
      continue;
    }

    try {
      await containers.stopContainer(container.id);

      logInfo('Container stopped for standby', { container: container.name });
    } catch (error) {
      logError('Standby sweep failed to stop container', error, { container: container.name });
    }
  }
};

export const applyRestartPolicy = async (policy: RestartPolicy) => {
  const containers = resolveContainerProvider();
  const managed = await listManagedContainers();

  for (const container of managed) {
    try {
      await containers.updateRestartPolicy(container.id, policy);
    } catch (error) {
      logError('Failed to update restart policy', error, { container: container.name });
    }
  }
};

export const startHealthMonitor = () => {
  const tick = () => {
    runHealthSweep().catch(error => {
      logError('Health sweep failed', error);
    });
  };

  tick();

  timer = setInterval(tick, config.healthCheckIntervalSeconds * 1000);
};

export const stopHealthMonitor = () => {
  if (timer) {
    clearInterval(timer);
    timer = undefined;
  }
};
