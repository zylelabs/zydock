import config from '../../config';
import { getDatabaseStatus } from '../../config/mongodb';
import { countClients } from '../websocket/websocket.service';

const startedAt = Date.now();

export const getHealthReport = () => {
  const database = getDatabaseStatus();

  return {
    status: database.connected ? 'ok' : 'degraded',
    version: config.version,
    commit: config.commit,
    uptime: Math.floor((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
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
