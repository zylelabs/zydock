import { createApp } from './src/app-server';
import config from './src/config';
import { logInfo } from './src/utils/logger';
import { websocket } from './src/utils/ws';

const app = createApp();

const tlsEnabled = Boolean(config.tls.certPath && config.tls.keyPath && config.tls.caPath);

logInfo('Zydock agent started', {
  port: config.port,
  bindHost: config.bindHost,
  mode: config.mode,
  serverId: config.serverId || 'pending',
  tls: tlsEnabled,
});

export default {
  port: config.port,
  hostname: config.bindHost,
  idleTimeout: config.idleTimeoutSeconds,
  fetch: app.fetch,
  websocket,
  ...(tlsEnabled
    ? {
        tls: {
          cert: Bun.file(config.tls.certPath),
          key: Bun.file(config.tls.keyPath),
          ca: Bun.file(config.tls.caPath),
          requestCert: true,
          rejectUnauthorized: true,
        },
      }
    : {}),
};
