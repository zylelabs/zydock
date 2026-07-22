import config from '../../config';
import { resolveContainerProvider } from '../../providers/container';
import { logError, logInfo } from '../../utils/logger';

export const AUTOHEAL_LABEL = 'zydock.autoheal';

let timer: ReturnType<typeof setInterval> | undefined;

let restarts = 0;

export const getRestartCount = () => restarts;

const needsHealing = (state: string, health: string) =>
  state === 'exited' || state === 'dead' || health === 'unhealthy';

export const runHealthSweep = async () => {
  const containers = resolveContainerProvider();

  const watched = await containers.listContainers({ labels: { [AUTOHEAL_LABEL]: 'true' } });

  const healed: string[] = [];

  for (const container of watched) {
    if (!needsHealing(container.state, container.health)) {
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
