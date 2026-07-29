import { Scalar } from '@scalar/hono-api-reference';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { showRoutes } from 'hono/dev';
import { HTTPException } from 'hono/http-exception';
import { requestId, type RequestIdVariables } from 'hono/request-id';
import { openAPIDoc } from 'hono-route-docs';
import config from './config';
import { connectDatabase, disconnectDatabase } from './config/mongodb';
import routes from './modules/routes';
import { stopLogStreams } from './modules/logs/log.service';
import { stopMetricStreams } from './modules/metrics/metric.service';
import { startWorker, stopWorker } from './modules/queue/queue.service';
import { logError, logInfo } from './utils/logger';

type AppEnv = { Variables: RequestIdVariables };

let isShuttingDown = false;

const connect = () => {
  connectDatabase()
    .then(startWorker)
    .catch(error => {
      logError('Failed to connect to MongoDB', error);
    });
};

const cleanup = async () => {
  try {
    stopWorker();
    stopLogStreams();
    stopMetricStreams();
    await disconnectDatabase();
  } catch (error) {
    logError('Failed to release resources during shutdown', error);
  }
};

const setupShutdownHandlers = () => {
  const shutdown = async (signal: string) => {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    logInfo('Graceful shutdown started', { signal });

    await cleanup();

    logInfo('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
};

const loadMiddlewares = (app: Hono<AppEnv>) => {
  app.use('*', requestId());
  app.use('*', cors({ origin: config.corsOrigin, credentials: true }));

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
      title: 'Zydock API',
      version: '0.1.0',
      description: 'Zydock deployment platform API documentation',
      prefix: '/api',
      components: {
        securitySchemes: {
          BearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
          ApiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
        },
      },
    }),
  );

  app.get(
    '/docs',
    Scalar({
      url: '/openapi.json',
      theme: 'kepler',
      layout: 'modern',
      showDeveloperTools: 'localhost',
      persistAuth: true,
      operationTitleSource: 'summary',
      defaultOpenAllTags: true,
      telemetry: false,
      orderRequiredPropertiesFirst: true,
      orderSchemaPropertiesBy: 'alpha',
    }),
  );
};

export const createApp = () => {
  const app = new Hono<AppEnv>();

  loadMiddlewares(app);
  loadRoutes(app);

  connect();
  setupShutdownHandlers();

  if (config.mode === 'dev') {
    showRoutes(app);
  }

  return app;
};
