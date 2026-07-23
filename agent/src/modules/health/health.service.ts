import { resolveContainerProvider } from '../../providers/container';
import { getRestartCount } from '../agent/monitor.service';

const startedAt = Date.now();

export const getHealthReport = async () => {
  let dockerStatus = 'up';
  let containers = 0;

  try {
    containers = (await resolveContainerProvider().listContainers()).length;
  } catch {
    dockerStatus = 'down';
  }

  return {
    status: dockerStatus === 'up' ? 'ok' : 'degraded',
    uptime: Math.floor((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
    dependencies: {
      docker: { status: dockerStatus, containers },
    },
    autoheal: { restarts: getRestartCount() },
  };
};
