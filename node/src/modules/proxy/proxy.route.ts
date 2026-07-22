import type { Context } from 'hono';
import { createRouter, validator } from 'hono-route-docs';
import { errorMessage } from '../../utils';
import { agentAuthMiddleware } from '../agent/agent.middleware';
import { proxyDocs } from './proxy.docs';
import {
  DomainParam,
  domainParamSchema,
  RouteIdParam,
  routeIdParamSchema,
  RouteSpecDTO,
  routeSpecSchema,
} from './proxy.schema';
import {
  enableTls,
  getCertificateStatus,
  getRoute,
  listRoutes,
  reload,
  removeRoute,
  renewCertificate,
  upsertRoute,
} from './proxy.service';

const { router, get, post, put, delete: del } = createRouter();

get('/routes', proxyDocs.list, agentAuthMiddleware, async (c: Context) =>
  c.json(await listRoutes()),
);

get(
  '/routes/:id',
  proxyDocs.get,
  agentAuthMiddleware,
  validator('param', routeIdParamSchema),
  async (c: Context) => {
    const { id } = c.req.valid('param' as never) as RouteIdParam;

    const route = await getRoute(id);

    if (!route) {
      return c.json({ error: 'Route not found' }, 404);
    }

    return c.json(route);
  },
);

put(
  '/routes/:id',
  proxyDocs.upsert,
  agentAuthMiddleware,
  validator('param', routeIdParamSchema),
  validator('json', routeSpecSchema),
  async (c: Context) => {
    const { id } = c.req.valid('param' as never) as RouteIdParam;
    const spec = c.req.valid('json' as never) as RouteSpecDTO;

    try {
      await upsertRoute({ ...spec, id });

      return c.json({ message: 'Route applied' });
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 400);
    }
  },
);

del(
  '/routes/:id',
  proxyDocs.remove,
  agentAuthMiddleware,
  validator('param', routeIdParamSchema),
  async (c: Context) => {
    const { id } = c.req.valid('param' as never) as RouteIdParam;

    try {
      await removeRoute(id);

      return c.json({ message: 'Route removed' });
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 400);
    }
  },
);

post(
  '/tls/:domain',
  proxyDocs.enableTls,
  agentAuthMiddleware,
  validator('param', domainParamSchema),
  async (c: Context) => {
    const { domain } = c.req.valid('param' as never) as DomainParam;

    try {
      await enableTls(domain);

      return c.json({ message: 'TLS enabled' });
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 400);
    }
  },
);

get(
  '/certificates/:domain',
  proxyDocs.certificate,
  agentAuthMiddleware,
  validator('param', domainParamSchema),
  async (c: Context) => {
    const { domain } = c.req.valid('param' as never) as DomainParam;

    return c.json(await getCertificateStatus(domain));
  },
);

post(
  '/certificates/:domain/renew',
  proxyDocs.renew,
  agentAuthMiddleware,
  validator('param', domainParamSchema),
  async (c: Context) => {
    const { domain } = c.req.valid('param' as never) as DomainParam;

    try {
      await renewCertificate(domain);

      return c.json({ message: 'Certificate re-evaluated' });
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 400);
    }
  },
);

post('/reload', proxyDocs.reload, agentAuthMiddleware, async (c: Context) => {
  try {
    await reload();

    return c.json({ message: 'Proxy reloaded' });
  } catch (error) {
    return c.json({ error: errorMessage(error) }, 400);
  }
});

export default router;
