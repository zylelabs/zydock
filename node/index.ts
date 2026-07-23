import { createApp } from './src/app-server';
import config from './src/config';
import { logInfo } from './src/utils/logger';
import { websocket } from './src/utils/ws';

const app = createApp();

logInfo('Zydock agent started', {
  port: config.port,
  mode: config.mode,
  serverId: config.serverId,
});

export default {
  port: config.port,
  idleTimeout: config.idleTimeoutSeconds,
  fetch: app.fetch,
  websocket,
};
