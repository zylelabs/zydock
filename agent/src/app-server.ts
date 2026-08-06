import { Hono } from 'hono';
import { showRoutes } from 'hono/dev';
import { HTTPException } from 'hono/http-exception';
import { requestId, type RequestIdVariables } from 'hono/request-id';
import { openAPIDoc } from 'hono-route-docs';
import config from './config';
import { startHeartbeat, stopHeartbeat } from './modules/agent/heartbeat.service';
import { startHealthMonitor, stopHealthMonitor } from './modules/agent/monitor.service';
import {
  startAccessAggregation,
  stopAccessAggregation,
} from './modules/proxy/proxy.aggregate.service';
import routes from './modules/routes';
import { logError, logInfo } from './utils/logger';

type AppEnv = { Variables: RequestIdVariables };

let isShuttingDown = false;

const cleanup = () => {
  stopHeartbeat();
  stopHealthMonitor();
  stopAccessAggregation();
};

const setupShutdownHandlers = () => {
  const shutdown = (signal: string) => {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    logInfo('Graceful shutdown started', { signal });

    cleanup();

    logInfo('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
};

const loadMiddlewares = (app: Hono<AppEnv>) => {
  app.use('*', requestId());

  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      return c.json({ error: error.message }, error.status);
    }

    logError('Unhandled request error', error, {
      requestId: c.get('requestId'),
      method: c.req.method,
      path: c.req.path,
    });

    return c.json({ error: 'Internal server error' }, 500);
  });

  app.notFound(c => c.json({ error: 'Not found' }, 404));
};

const loadRoutes = (app: Hono<AppEnv>) => {
  app.route('/api/', routes);

  app.get(
    '/openapi.json',
    openAPIDoc(routes, {
      title: 'Zydock Agent API',
      version: '0.1.0',
      description: 'Local agent installed on each managed server',
      prefix: '/api',
      components: {
        securitySchemes: {
          AgentToken: { type: 'apiKey', in: 'header', name: 'X-Agent-Token' },
        },
      },
    }),
  );
};

export const createApp = () => {
  const app = new Hono<AppEnv>();

  loadMiddlewares(app);
  loadRoutes(app);

  startHeartbeat();
  startHealthMonitor();
  startAccessAggregation();
  setupShutdownHandlers();

  if (config.mode === 'dev') {
    showRoutes(app);
  }

  return app;
};
