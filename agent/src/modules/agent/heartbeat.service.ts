import config from '../../config';
import { logDebug, logWarn } from '../../utils/logger';
import { composeVersion } from '../compose/compose.service';
import { collectSystemMetrics } from '../metrics/metrics.service';
import { resolveServerId } from './identity.service';

const AGENT_VERSION = '0.1.0';

let timer: ReturnType<typeof setInterval> | undefined;

const readComposeVersion = async () => {
  try {
    return await composeVersion();
  } catch {
    return undefined;
  }
};

const sendHeartbeat = async () => {
  const serverId = await resolveServerId();
  const [metrics, composeVersionReported] = await Promise.all([
    collectSystemMetrics(),
    readComposeVersion(),
  ]);

  const response = await fetch(`${config.backendUrl}/api/agent/heartbeat/${serverId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Agent-Token': config.agentToken,
    },
    body: JSON.stringify({
      version: AGENT_VERSION,
      metrics,
      composeVersion: composeVersionReported,
    }),
  });

  if (!response.ok) {
    throw new Error(`backend answered ${response.status}`);
  }

  logDebug('Heartbeat delivered');
};

export const startHeartbeat = () => {
  const tick = () => {
    sendHeartbeat().catch(error => {
      logWarn('Heartbeat failed, will retry', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  };

  tick();

  timer = setInterval(tick, config.heartbeatIntervalSeconds * 1000);
};

export const stopHeartbeat = () => {
  if (timer) {
    clearInterval(timer);
    timer = undefined;
  }
};
