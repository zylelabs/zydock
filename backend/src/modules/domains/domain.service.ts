import config from '../../config';
import {
  resolveReverseProxyProvider,
  type CertificateStatus,
  type ReverseProxyProvider,
  type RouteSpec,
} from '../../providers/reverse-proxy';
import { logError, logInfo } from '../../utils/logger';
import applicationModel from '../applications/application.model';
import { containerNameOf } from '../deployments/naming';
import { buildAgentConnection, findServerById } from '../servers/server.service';
import domainModel from './domain.model';

const routeSpecOf = (domain: Domain, application: Application): RouteSpec => ({
  id: String(domain._id),
  domain: domain.hostname,
  upstreams: [{ host: containerNameOf(application.slug), port: application.port }],
  pathPrefix: domain.pathPrefix,
  tls: domain.tls,
});

export const findDomain = (organizationId: string, domainId: string) =>
  domainModel.findOne({ _id: domainId, organizationId });

export const listDomainsOfApplication = (applicationId: string) =>
  domainModel.find({ applicationId });

export const findDomainsByHostnames = (hostnames: string[]) =>
  domainModel.find({ hostname: { $in: hostnames } });

const resolveProxyOfServer = async (serverId: string): Promise<ReverseProxyProvider> => {
  const server = await findServerById(serverId);

  if (!server) {
    throw new Error('Server not found');
  }

  return resolveReverseProxyProvider(buildAgentConnection(server));
};

const applyRoute = async (
  proxy: ReverseProxyProvider,
  domain: Domain,
  application: Application,
) => {
  try {
    await proxy.upsertRoute(routeSpecOf(domain, application));

    if (domain.tls) {
      await proxy.enableTls(domain.hostname);
    }

    await domainModel.updateOne(
      { _id: domain._id },
      { $set: { status: 'active' }, $unset: { lastError: '' } },
    );

    logInfo('Domain applied', { domain: domain.hostname, application: String(application._id) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    await domainModel.updateOne(
      { _id: domain._id },
      { $set: { status: 'error', lastError: message } },
    );

    throw error;
  }
};

export const applyApplicationDomains = async (
  application: Application,
  connection: { serverId: string; endpoint: string; token: string },
) => {
  const domains = await listDomainsOfApplication(String(application._id));

  if (domains.length === 0) {
    return [];
  }

  const proxy = resolveReverseProxyProvider(connection);

  for (const domain of domains) {
    await applyRoute(proxy, domain, application);
  }

  return domains;
};

export const applyDomain = async (domain: Domain) => {
  const application = await applicationModel.findById(domain.applicationId);

  if (!application) {
    throw new Error('Application not found');
  }

  const proxy = await resolveProxyOfServer(String(domain.serverId));

  await applyRoute(proxy, domain, application);
};

export const getDomainCertificate = async (domain: Domain): Promise<CertificateStatus> => {
  const proxy = await resolveProxyOfServer(String(domain.serverId));

  return proxy.getCertificateStatus(domain.hostname);
};

export const renewDomainCertificate = async (domain: Domain) => {
  const proxy = await resolveProxyOfServer(String(domain.serverId));

  await proxy.renewCertificate(domain.hostname);
};

const removeRoute = async (domain: Domain) => {
  try {
    const proxy = await resolveProxyOfServer(String(domain.serverId));

    await proxy.removeRoute(String(domain._id));
  } catch (error) {
    logError('Failed to remove the proxy route of a domain', error, { domain: domain.hostname });
  }
};

export const removeDomain = async (domain: Domain) => {
  await removeRoute(domain);
  await domainModel.deleteOne({ _id: domain._id });
};

export const removeDomainsOfApplications = async (applicationIds: string[]) => {
  const domains = await domainModel.find({ applicationId: { $in: applicationIds } });

  for (const domain of domains) {
    await removeRoute(domain);
  }

  await domainModel.deleteMany({ applicationId: { $in: applicationIds } });
};

export const hostnameTaken = (hostname: string) => domainModel.exists({ hostname }).then(Boolean);

export const createDomain = (params: {
  organizationId: string;
  applicationId: string;
  serverId: string;
  hostname: string;
  pathPrefix?: string;
  tls: boolean;
}) => domainModel.create(params);

export const updateDomain = async (domain: Domain, changes: UpdateDomainChanges) => {
  const update: Record<string, unknown> = {};
  const unset: Record<string, unknown> = {};

  if (changes.tls !== undefined) {
    update.tls = changes.tls;
  }

  if (changes.pathPrefix === null) {
    unset.pathPrefix = '';
  } else if (changes.pathPrefix !== undefined) {
    update.pathPrefix = changes.pathPrefix;
  }

  await domainModel.updateOne(
    { _id: domain._id },
    {
      ...(Object.keys(update).length ? { $set: update } : {}),
      ...(Object.keys(unset).length ? { $unset: unset } : {}),
    },
  );

  return domainModel.findById(domain._id);
};

type UpdateDomainChanges = { pathPrefix?: string | null; tls?: boolean };

export const listDomainsOfOrganization = (organizationId: string) =>
  domainModel.find({ organizationId }).sort({ createdAt: 1 });

export const serializeDomain = (domain: Domain) => ({
  id: String(domain._id),
  organizationId: String(domain.organizationId),
  applicationId: String(domain.applicationId),
  serverId: String(domain.serverId),
  hostname: domain.hostname,
  pathPrefix: domain.pathPrefix,
  tls: domain.tls,
  status: domain.status,
  lastError: domain.lastError,
  createdAt: domain.createdAt,
  updatedAt: domain.updatedAt,
});
