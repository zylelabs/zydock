import { readFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import config from '../../config';
import { createTtlCache } from '../../utils/cache';
import { logDebug, logInfo, logWarn } from '../../utils/logger';
import { composeVersion } from '../compose/compose.service';
import { collectSystemMetrics } from '../metrics/metrics.service';
import { resolveServerId } from './identity.service';
import {
  applyRestartPolicy,
  runStandbySweep,
  startHealthMonitor,
  stopHealthMonitor,
} from './monitor.service';

const AGENT_VERSION = '0.1.0';

const COMPOSE_VERSION_TTL_SECONDS = 3600;

const INSTALLATION_ROLES = ['active', 'standby'] as const;

type InstallationRole = (typeof INSTALLATION_ROLES)[number];

const rolePath = () => join(config.installPath, '.zydock-role');

const readPersistedRole = (): InstallationRole => {
  try {
    const value = readFileSync(rolePath(), 'utf8').trim();

    return value === 'standby' ? 'standby' : 'active';
  } catch {
    return 'active';
  }
};

let role: InstallationRole = readPersistedRole();

export const getRole = () => role;

const applyRole = async (nextRole: InstallationRole) => {
  if (nextRole === role) {
    return;
  }

  role = nextRole;
  await Bun.write(rolePath(), role);

  if (role === 'standby') {
    stopHealthMonitor();
    await runStandbySweep();
    await applyRestartPolicy('no');
  } else {
    await applyRestartPolicy('unless-stopped');
    startHealthMonitor();
  }

  logInfo('Installation role changed', { role });
};

export const applyBootRole = async () => {
  if (role === 'standby') {
    await runStandbySweep();
  }
};

let timer: ReturnType<typeof setInterval> | undefined;
let detectedPublicIp: string | undefined;

const composeVersionCache = createTtlCache<string | undefined>(COMPOSE_VERSION_TTL_SECONDS);

const readComposeVersion = () =>
  composeVersionCache.resolve(async () => {
    try {
      return await composeVersion();
    } catch {
      return undefined;
    }
  });

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

  const body = (await response.json()) as { role?: string };

  if (body.role === 'active' || body.role === 'standby') {
    await applyRole(body.role);
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
