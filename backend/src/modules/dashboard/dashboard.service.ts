import { resolve4, resolve6 } from 'node:dns/promises';
import config from '../../config';
import { logWarn } from '../../utils/logger';
import dashboardModel from './dashboard.model';
import type { DashboardStatus } from './dashboard.schema';

const DEFAULT_DASHBOARD = { domain: '', name: config.dashboard.name, status: 'disabled' as const };

export const getDashboardDocument = async () => {
  const document = await dashboardModel.findOneAndUpdate(
    {},
    { $setOnInsert: DEFAULT_DASHBOARD },
    { upsert: true, new: true },
  );

  return document!;
};

export const bootstrapDashboard = async () => {
  try {
    const existing = await dashboardModel.findOne({});

    if (existing) {
      return;
    }

    const domain = config.dashboard.domain;

    await dashboardModel.create({
      domain,
      name: config.dashboard.name,
      status: domain ? 'pending' : 'disabled',
    });
  } catch (error) {
    logWarn('The dashboard module could not be bootstrapped', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export const saveDashboardDomain = async (domain: string) => {
  const current = await getDashboardDocument();

  await dashboardModel.updateOne(
    { _id: current._id },
    {
      $set: { domain, status: domain ? 'pending' : 'disabled' },
      $unset: {
        lastError: '',
        certificateIssuer: '',
        certificateExpiresAt: '',
        appliedAt: '',
      },
    },
  );

  invalidatePublicUrlCache();

  return getDashboardDocument();
};

export const saveDashboardName = async (name: string) => {
  const current = await getDashboardDocument();

  await dashboardModel.updateOne({ _id: current._id }, { $set: { name } });

  invalidatePublicUrlCache();

  return getDashboardDocument();
};

export const resolveDnsMismatch = async (domain: string) => {
  if (!domain || !config.localServer.publicIp) {
    return false;
  }

  const [records4, records6] = await Promise.all([
    resolve4(domain).catch(() => []),
    resolve6(domain).catch(() => []),
  ]);

  const records = [...records4, ...records6];

  if (!records.length) {
    return false;
  }

  return !records.includes(config.localServer.publicIp);
};

let cachedDashboard: { domain: string; name: string; status: DashboardStatus } | undefined;

export const invalidatePublicUrlCache = () => {
  cachedDashboard = undefined;
};

const cachedDashboardState = async () => {
  if (!cachedDashboard) {
    const document = await getDashboardDocument();

    cachedDashboard = { domain: document.domain, name: document.name, status: document.status };
  }

  return cachedDashboard;
};

export const resolvePublicUrl = async () => {
  const { domain, status } = await cachedDashboardState();
  const hasReachableDomain = Boolean(domain) && (status === 'active' || status === 'pending');

  return hasReachableDomain ? `https://${domain}` : config.appUrl;
};

export const resolveDashboardCorsOrigins = async () => {
  const { domain } = await cachedDashboardState();

  return domain ? [`https://${domain}`, `http://${domain}`] : [];
};

export const resolvePanelName = async () => {
  const { name } = await cachedDashboardState();

  return name;
};

export const serializeDashboardSettings = (document: Dashboard) => ({
  domain: document.domain,
  name: document.name,
  status: document.status,
  lastError: document.lastError,
  certificateIssuer: document.certificateIssuer,
  certificateExpiresAt: document.certificateExpiresAt,
  appliedAt: document.appliedAt,
});
