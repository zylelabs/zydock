import { createApp } from './src/app-server';
import config from './src/config';
import { websocket } from './src/modules/websocket/websocket.service';
import { logInfo } from './src/utils/logger';

const app = createApp();

logInfo('Nexus backend started', { port: config.port, mode: config.mode });

export default {
  port: config.port,
  fetch: app.fetch,
  websocket,
};
