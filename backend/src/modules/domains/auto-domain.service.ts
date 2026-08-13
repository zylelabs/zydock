import config from '../../config';
import { logError, logInfo } from '../../utils/logger';
import { findEnvironmentOfOrganization } from '../projects/environment.service';
import { findServerById, isPublicIp } from '../servers/server.service';
import {
  createDomain,
  demoteAutoDomain,
  hostnameTaken,
  listDomainsOfApplication,
  removeDomain,
} from './domain.service';

const ipLabelOf = (ip: string) => ip.replace(/[.:]/g, '-');

const hostnameOf = (slug: string, ipLabel: string) =>
  `${slug}.${ipLabel}.${config.autoDomain.suffix}`;

const hostnameWithEnvironmentOf = (slug: string, environmentSlug: string, ipLabel: string) =>
  `${slug}-${environmentSlug}.${ipLabel}.${config.autoDomain.suffix}`;

export const buildAutoDomainHostname = async (params: {
  slug: string;
  environmentSlug: string;
  publicIp: string;
}) => {
  const ipLabel = ipLabelOf(params.publicIp);
  const base = hostnameOf(params.slug, ipLabel);

  if (!(await hostnameTaken(base))) {
    return base;
  }

  return hostnameWithEnvironmentOf(params.slug, params.environmentSlug, ipLabel);
};

export const ensureAutoDomain = async (application: Application) => {
  const applicationId = String(application._id);

  if (!config.autoDomain.enabled) {
    logInfo('Skipped automatic domain: feature disabled', { application: applicationId });
    return undefined;
  }

  if (application.autoDomainDisabled) {
    logInfo('Skipped automatic domain: disabled by the user', { application: applicationId });
    return undefined;
  }

  try {
    const existing = await listDomainsOfApplication(applicationId);

    if (existing.some(domain => domain.auto)) {
      return undefined;
    }

    const server = await findServerById(String(application.serverId));

    if (!server?.publicIp || !isPublicIp(server.publicIp)) {
      logInfo('Skipped automatic domain: server has no usable public IP', {
        application: applicationId,
        server: String(application.serverId),
      });
      return undefined;
    }

    const environment = await findEnvironmentOfOrganization(
      String(application.organizationId),
      String(application.environmentId),
    );

    if (!environment) {
      logInfo('Skipped automatic domain: environment not found', { application: applicationId });
      return undefined;
    }

    const hostname = await buildAutoDomainHostname({
      slug: application.slug,
      environmentSlug: environment.slug,
      publicIp: server.publicIp,
    });

    return await createDomain({
      organizationId: String(application.organizationId),
      applicationId,
      serverId: String(application.serverId),
      hostname,
      tls: false,
      auto: true,
    });
  } catch (error) {
    logError('Failed to create the automatic domain', error, { application: applicationId });
    return undefined;
  }
};

export const refreshAutoDomainAfterUpdate = async (
  previous: { slug: string; serverId: string },
  updated: Application,
) => {
  const slugChanged = previous.slug !== updated.slug;
  const serverChanged = previous.serverId !== String(updated.serverId);

  if (!slugChanged && !serverChanged) {
    return;
  }

  const applicationId = String(updated._id);

  try {
    const existingAuto = (await listDomainsOfApplication(applicationId)).find(
      domain => domain.auto,
    );

    if (existingAuto) {
      if (serverChanged) {
        await removeDomain(existingAuto);
      } else {
        await demoteAutoDomain(existingAuto);
      }
    }

    await ensureAutoDomain(updated);
  } catch (error) {
    logError('Failed to refresh the automatic domain', error, { application: applicationId });
  }
};
