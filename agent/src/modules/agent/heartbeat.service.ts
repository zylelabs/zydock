import { networkInterfaces } from 'node:os';
import config from '../../config';
import { logDebug, logWarn } from '../../utils/logger';
import { composeVersion } from '../compose/compose.service';
import { collectSystemMetrics } from '../metrics/metrics.service';
import { resolveServerId } from './identity.service';

const AGENT_VERSION = '0.1.0';

let timer: ReturnType<typeof setInterval> | undefined;
let detectedPublicIp: string | undefined;

const readComposeVersion = async () => {
  try {
    return await composeVersion();
  } catch {
    return undefined;
  }
};

const isPrivateIpv4 = (value: string) => {
  const [a, b] = value.split('.').map(Number);

  return (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
};

const detectPublicIp = () => {
  if (detectedPublicIp) {
    return detectedPublicIp;
  }

  const interfaces = Object.values(networkInterfaces()).flat();

  const found = interfaces.find(
    entry => entry && entry.family === 'IPv4' && !entry.internal && !isPrivateIpv4(entry.address),
  );

  detectedPublicIp = found?.address;

  return detectedPublicIp;
};

const sendHeartbeat = async () => {
  const serverId = await resolveServerId();
  const publicIp = detectPublicIp();
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
      publicIp,
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
