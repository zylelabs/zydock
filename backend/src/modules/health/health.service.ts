import config from '../../config';
import { getDatabaseStatus } from '../../config/mongodb';
import { resolvePanelName } from '../dashboard/dashboard.service';
import { countClients } from '../websocket/websocket.service';

const startedAt = Date.now();

export const getHealthReport = async () => {
  const database = getDatabaseStatus();

  return {
    status: database.connected ? 'ok' : 'degraded',
    version: config.version,
    commit: config.commit,
    panelName: database.connected ? await resolvePanelName() : config.dashboard.name,
    uptime: Math.floor((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
    autoDomain: {
      enabled: config.autoDomain.enabled,
      suffix: config.autoDomain.suffix,
    },
    dependencies: {
      database: {
        status: database.connected ? 'up' : 'down',
        state: database.state,
      },
      websocket: {
        status: 'up',
        clients: countClients(),
      },
    },
  };
};
