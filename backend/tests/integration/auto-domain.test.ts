import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../../src/config/mongodb';
import applicationModel from '../../src/modules/applications/application.model';
import {
  buildAutoDomainHostname,
  ensureAutoDomain,
} from '../../src/modules/domains/auto-domain.service';
import domainModel from '../../src/modules/domains/domain.model';
import environmentModel from '../../src/modules/projects/environment.model';
import projectModel from '../../src/modules/projects/project.model';
import serverModel from '../../src/modules/servers/server.model';

const objectId = () => new mongoose.Types.ObjectId().toString();

describe('auto-domain', () => {
  let organizationId: string;
  let projectId: string;

  beforeAll(async () => {
    await connectDatabase();

    organizationId = objectId();

    const project = await projectModel.create({
      organizationId,
      name: 'Auto Domain Project',
      slug: 'auto-domain-project',
    });

    projectId = String(project._id);
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await disconnectDatabase();
  });

  describe('buildAutoDomainHostname', () => {
    test('is stable, lowercase and valid for DNS', async () => {
      const hostname = await buildAutoDomainHostname({
        slug: 'My-App',
        environmentSlug: 'production',
        publicIp: '203.0.113.10',
      });

      expect(hostname).toBe('my-app.203-0-113-10.backname.io');
      expect(hostname).toBe(hostname.toLowerCase());
      expect(hostname).toMatch(
        /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/,
      );
      expect(hostname.length).toBeLessThanOrEqual(253);

      const hostnameAgain = await buildAutoDomainHostname({
        slug: 'My-App',
        environmentSlug: 'production',
        publicIp: '203.0.113.10',
      });

      expect(hostnameAgain).toBe(hostname);
    });

    test('generates distinct hostnames when the slug collides across environments', async () => {
      const server = await serverModel.create({
        organizationId,
        name: 'Collision Server',
        publicIp: '203.0.113.20',
      });

      const productionEnvironment = await environmentModel.create({
        organizationId,
        projectId,
        name: 'Production',
        slug: 'production',
      });

      const stagingEnvironment = await environmentModel.create({
        organizationId,
        projectId,
        name: 'Staging',
        slug: 'staging',
      });

      const productionApplication = await applicationModel.create({
        organizationId,
        projectId,
        environmentId: productionEnvironment._id,
        serverId: server._id,
        name: 'api',
        slug: 'api',
      });

      await ensureAutoDomain(productionApplication as unknown as Application);

      const stagingHostname = await buildAutoDomainHostname({
        slug: 'api',
        environmentSlug: stagingEnvironment.slug,
        publicIp: server.publicIp as string,
      });

      expect(stagingHostname).toBe('api-staging.203-0-113-20.backname.io');
      expect(stagingHostname).not.toBe('api.203-0-113-20.backname.io');
    });
  });

  describe('ensureAutoDomain', () => {
    test('does not create a domain when the server has no public IP', async () => {
      const server = await serverModel.create({
        organizationId,
        name: 'No Public IP Server',
      });

      const environment = await environmentModel.create({
        organizationId,
        projectId,
        name: 'No IP Environment',
        slug: 'no-ip',
      });

      const application = await applicationModel.create({
        organizationId,
        projectId,
        environmentId: environment._id,
        serverId: server._id,
        name: 'no-ip-app',
        slug: 'no-ip-app',
      });

      const result = await ensureAutoDomain(application as unknown as Application);

      expect(result).toBeUndefined();

      const domains = await domainModel.find({ applicationId: application._id });

      expect(domains).toHaveLength(0);
    });
  });
});
