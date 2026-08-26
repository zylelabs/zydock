import { resolveContainerProvider } from '../../providers/container';
import { errorMessage } from '../../utils';
import { logWarn } from '../../utils/logger';
import { APPLICATION_LABEL } from '../deployments/naming';
import { buildAgentConnection, findServerById } from '../servers/server.service';

const RESERVED_HOST_PORTS: Record<number, string> = {
  80: 'the Zydock proxy (:80)',
  443: 'the Zydock proxy (:443)',
};

export type HostPortBinding = { port: number; protocol: 'tcp' | 'udp' };

export type HostPortConflict = { port: number; owner: string };

export type HostPortExclude = { applicationId?: string; containerName?: string };

export const findHostPortConflict = async (
  serverId: string,
  hostPorts: HostPortBinding[],
  exclude?: HostPortExclude,
): Promise<HostPortConflict | null> => {
  if (!hostPorts.length) {
    return null;
  }

  for (const binding of hostPorts) {
    if (RESERVED_HOST_PORTS[binding.port]) {
      return { port: binding.port, owner: RESERVED_HOST_PORTS[binding.port] };
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
      if (exclude?.applicationId && container.labels[APPLICATION_LABEL] === exclude.applicationId) {
        continue;
      }

      if (exclude?.containerName && container.name === exclude.containerName) {
        continue;
      }

      for (const binding of container.ports) {
        if (binding.hostPort === undefined) {
          continue;
        }

        const taken = hostPorts.some(
          wanted => wanted.port === binding.hostPort && wanted.protocol === binding.protocol,
        );

        if (taken) {
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
