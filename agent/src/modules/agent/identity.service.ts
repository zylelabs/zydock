import config from '../../config';

let resolvedServerId = config.serverId || undefined;

export const getServerId = () => resolvedServerId;

export const resolveServerId = async () => {
  if (resolvedServerId) {
    return resolvedServerId;
  }

  const response = await fetch(`${config.backendUrl}/api/agent/identity`, {
    headers: { 'X-Agent-Token': config.agentToken },
  });

  if (!response.ok) {
    throw new Error(`backend answered ${response.status} for identity`);
  }

  const body = (await response.json()) as { serverId: string };

  resolvedServerId = body.serverId;

  return resolvedServerId;
};
