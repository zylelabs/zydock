import type { Context } from 'hono';
import { createRouter, validator } from 'hono-route-docs';
import config from '../../config';
import { errorMessage } from '../../utils';
import { agentFailureStatus } from '../../utils/agent';
import { authMiddleware, requireSuperuser } from '../auth/auth.middleware';
import { hostnameTaken } from '../domains/domain.service';
import { applyDashboardDomain, refreshDashboardCertificate } from './dashboard-route.service';
import {
  getDashboardDocument,
  resolveDnsMismatch,
  saveDashboardDomain,
  saveDashboardName,
  serializeDashboardSettings,
} from './dashboard.service';
import {
  updateDashboardSettingsSchema,
  type UpdateDashboardSettingsDTO,
} from './dashboard.schema';
import { dashboardDocs } from './dashboard.docs';

const { router, get, patch, post, delete: del } = createRouter();

const settingsPayload = async (c: Context, document: Dashboard) => ({
  ...serializeDashboardSettings(document),
  publicIp: config.localServer.publicIp,
  ipUrl: config.appUrl,
  requestHost: c.req.header('host') ?? '',
  dnsMismatch: await resolveDnsMismatch(document.domain),
});

get('/settings', dashboardDocs.getSettings, authMiddleware, requireSuperuser, async (c: Context) =>
  c.json(await settingsPayload(c, await getDashboardDocument())),
);

patch(
  '/settings',
  dashboardDocs.updateSettings,
  authMiddleware,
  requireSuperuser,
  validator('json', updateDashboardSettingsSchema),
  async (c: Context) => {
    const { domain, name } = c.req.valid('json' as never) as UpdateDashboardSettingsDTO;

    if (name !== undefined) {
      await saveDashboardName(name);
    }

    const current = await getDashboardDocument();

    if (domain === undefined || domain === current.domain) {
      return c.json(await settingsPayload(c, await getDashboardDocument()));
    }

    if (domain && (await hostnameTaken(domain))) {
      return c.json({ error: 'This hostname is already in use by an application domain' }, 409);
    }

    await saveDashboardDomain(domain);

    const document = await applyDashboardDomain(domain).catch(() => getDashboardDocument());

    return c.json(await settingsPayload(c, document));
  },
);

del('/domain', dashboardDocs.removeDomain, authMiddleware, requireSuperuser, async (c: Context) => {
  await saveDashboardDomain('');

  const document = await applyDashboardDomain('').catch(() => getDashboardDocument());

  return c.json(await settingsPayload(c, document));
});

post('/domain/check', dashboardDocs.check, authMiddleware, requireSuperuser, async (c: Context) => {
  try {
    return c.json(await settingsPayload(c, await refreshDashboardCertificate()));
  } catch (error) {
    return c.json({ error: errorMessage(error) }, agentFailureStatus(error));
  }
});

export default router;
