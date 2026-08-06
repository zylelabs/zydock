import { resolveContainerProvider } from '../../providers/container';
import { errorMessage } from '../../utils';
import { logWarn } from '../../utils/logger';
import { APPLICATION_LABEL } from '../deployments/naming';
import { buildAgentConnection, findServerById } from '../servers/server.service';

const RESERVED_HOST_PORTS: Record<number, string> = {
  80: 'the Zydock proxy (:80)',
  443: 'the Zydock proxy (:443)',
};

export type HostPortConflict = { port: number; owner: string };

export const findHostPortConflict = async (
  serverId: string,
  hostPorts: number[],
  excludeApplicationId?: string,
): Promise<HostPortConflict | null> => {
  if (!hostPorts.length) {
    return null;
  }

  for (const port of hostPorts) {
    if (RESERVED_HOST_PORTS[port]) {
      return { port, owner: RESERVED_HOST_PORTS[port] };
    }
  }

  const server = await findServerById(serverId);

  if (!server) {
    return null;
  }

  try {
    const containers = resolveContainerProvider(buildAgentConnection(server));
    const running = await containers.listContainers();

    for (const container of running) {
      if (excludeApplicationId && container.labels[APPLICATION_LABEL] === excludeApplicationId) {
        continue;
      }

      for (const binding of container.ports) {
        if (binding.hostPort && hostPorts.includes(binding.hostPort)) {
          return { port: binding.hostPort, owner: container.name };
        }
      }
    }

    return null;
  } catch (error) {
    logWarn('Could not check host port availability on the server', {
      serverId,
      error: errorMessage(error),
    });

    return null;
  }
};
