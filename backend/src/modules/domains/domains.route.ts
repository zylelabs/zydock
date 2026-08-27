import type { Context } from 'hono';
import { createRouter, validator } from 'hono-route-docs';
import { errorMessage } from '../../utils';
import { agentFailureStatus } from '../../utils/agent';
import { paginationQuery } from '../../utils/pagination';
import { disableAutoDomain, findApplication } from '../applications/application.service';
import { authMiddleware } from '../auth/auth.middleware';
import { blockOnStandby } from '../installation/installation.middleware';
import { OrganizationIdParam, organizationIdParamSchema } from '../organizations/membership.schema';
import { createOrganizationRoleGuard } from '../organizations/organizations.middleware';
import domainModel from './domain.model';
import {
  CreateDomainDTO,
  createDomainSchema,
  DomainIdParam,
  domainIdParamSchema,
  ListDomainsQuery,
  listDomainsQuerySchema,
  UpdateDomainDTO,
  updateDomainSchema,
} from './domain.schema';
import {
  applyDomain,
  createDomain,
  findDomain,
  getDomainCertificate,
  hostnameTaken,
  removeDomain,
  renewDomainCertificate,
  serializeDomain,
  updateDomain,
} from './domain.service';
import { domainsDocs } from './domains.docs';

const { router, get, post, patch, delete: del } = createRouter();

get(
  '/',
  domainsDocs.list,
  authMiddleware,
  validator('param', organizationIdParamSchema),
  createOrganizationRoleGuard('member'),
  validator('query', listDomainsQuerySchema),
  async (c: Context) => {
    const { organizationId } = c.req.valid('param' as never) as OrganizationIdParam;
    const { applicationId } = c.req.valid('query' as never) as ListDomainsQuery;
    const { page, size, sort, order } = paginationQuery(c);

    const result = await domainModel.paginate(
      { organizationId, ...(applicationId ? { applicationId } : {}) },
      { page, size, sort, order },
    );

    return c.json({ ...result, items: result.items.map(serializeDomain) });
  },
);

post(
  '/',
  domainsDocs.create,
  authMiddleware,
  validator('param', organizationIdParamSchema),
  createOrganizationRoleGuard('admin'),
  blockOnStandby,
  validator('json', createDomainSchema),
  async (c: Context) => {
    const { organizationId } = c.req.valid('param' as never) as OrganizationIdParam;
    const body = c.req.valid('json' as never) as CreateDomainDTO;

    const application = await findApplication(organizationId, body.applicationId);

    if (!application) {
      return c.json({ error: 'Application not found in this organization' }, 400);
    }

    if (application.source === 'compose' && application.compose?.expose.kind !== 'http') {
      return c.json(
        {
          error:
            'This application is not reached over HTTP ("expose.kind" is not "http"), ' +
            'so it cannot have a domain',
        },
        400,
      );
    }

    if (await hostnameTaken(body.hostname)) {
      return c.json({ error: 'This hostname is already in use' }, 409);
    }

    const domain = await createDomain({
      organizationId,
      applicationId: body.applicationId,
      serverId: String(application.serverId),
      hostname: body.hostname,
      pathPrefix: body.pathPrefix,
      tls: body.tls,
    });

    await applyDomain(domain).catch(() => undefined);

    return c.json({ domain: serializeDomain((await domainModel.findById(domain._id))!) }, 201);
  },
);

get(
  '/:domainId',
  domainsDocs.get,
  authMiddleware,
  validator('param', domainIdParamSchema),
  createOrganizationRoleGuard('member'),
  async (c: Context) => {
    const { organizationId, domainId } = c.req.valid('param' as never) as DomainIdParam;

    const domain = await findDomain(organizationId, domainId);

    if (!domain) {
      return c.json({ error: 'Domain not found' }, 404);
    }

    return c.json({ domain: serializeDomain(domain) });
  },
);

patch(
  '/:domainId',
  domainsDocs.update,
  authMiddleware,
  validator('param', domainIdParamSchema),
  createOrganizationRoleGuard('admin'),
  blockOnStandby,
  validator('json', updateDomainSchema),
  async (c: Context) => {
    const { organizationId, domainId } = c.req.valid('param' as never) as DomainIdParam;
    const body = c.req.valid('json' as never) as UpdateDomainDTO;

    const domain = await findDomain(organizationId, domainId);

    if (!domain) {
      return c.json({ error: 'Domain not found' }, 404);
    }

    const updated = await updateDomain(domain, body);

    await applyDomain(updated!).catch(() => undefined);

    return c.json({ domain: serializeDomain((await domainModel.findById(domainId))!) });
  },
);

post(
  '/:domainId/apply',
  domainsDocs.apply,
  authMiddleware,
  validator('param', domainIdParamSchema),
  createOrganizationRoleGuard('admin'),
  blockOnStandby,
  async (c: Context) => {
    const { organizationId, domainId } = c.req.valid('param' as never) as DomainIdParam;

    const domain = await findDomain(organizationId, domainId);

    if (!domain) {
      return c.json({ error: 'Domain not found' }, 404);
    }

    try {
      await applyDomain(domain);

      return c.json({ domain: serializeDomain((await domainModel.findById(domainId))!) });
    } catch (error) {
      return c.json({ error: errorMessage(error) }, agentFailureStatus(error));
    }
  },
);

get(
  '/:domainId/certificate',
  domainsDocs.certificate,
  authMiddleware,
  validator('param', domainIdParamSchema),
  createOrganizationRoleGuard('member'),
  async (c: Context) => {
    const { organizationId, domainId } = c.req.valid('param' as never) as DomainIdParam;

    const domain = await findDomain(organizationId, domainId);

    if (!domain) {
      return c.json({ error: 'Domain not found' }, 404);
    }

    try {
      return c.json(await getDomainCertificate(domain));
    } catch (error) {
      return c.json({ error: errorMessage(error) }, agentFailureStatus(error));
    }
  },
);

post(
  '/:domainId/renew',
  domainsDocs.renew,
  authMiddleware,
  validator('param', domainIdParamSchema),
  createOrganizationRoleGuard('admin'),
  blockOnStandby,
  async (c: Context) => {
    const { organizationId, domainId } = c.req.valid('param' as never) as DomainIdParam;

    const domain = await findDomain(organizationId, domainId);

    if (!domain) {
      return c.json({ error: 'Domain not found' }, 404);
    }

    try {
      await renewDomainCertificate(domain);

      return c.json({ message: 'Renewal requested' });
    } catch (error) {
      return c.json({ error: errorMessage(error) }, agentFailureStatus(error));
    }
  },
);

del(
  '/:domainId',
  domainsDocs.remove,
  authMiddleware,
  validator('param', domainIdParamSchema),
  createOrganizationRoleGuard('admin'),
  blockOnStandby,
  async (c: Context) => {
    const { organizationId, domainId } = c.req.valid('param' as never) as DomainIdParam;

    const domain = await findDomain(organizationId, domainId);

    if (!domain) {
      return c.json({ error: 'Domain not found' }, 404);
    }

    if (domain.auto) {
      await disableAutoDomain(String(domain.applicationId));
    }

    await removeDomain(domain);

    return c.json({ message: 'Domain removed successfully' });
  },
);

export default router;
