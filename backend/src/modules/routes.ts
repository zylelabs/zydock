import { createRouter } from 'hono-route-docs';
import applicationsRoute from './applications/applications.route';
import backupsRoute from './backups/backups.route';
import webhookRoute from './applications/webhook.route';
import apiKeyRoute from './auth/api-key.route';
import consoleRoute from './console/console.route';
import containersRoute from './containers/containers.route';
import databasesRoute from './databases/databases.route';
import deploymentLogsRoute from './deployments/deployment-logs.route';
import deploymentsRoute from './deployments/deployments.route';
import domainsRoute from './domains/domains.route';
import authRoute from './auth/auth.route';
import sessionRoute from './auth/session.route';
import healthRoute from './health/health.route';
import imagesRoute from './images/images.route';
import networksRoute from './networks/networks.route';
import volumesRoute from './volumes/volumes.route';
import applicationLogsRoute from './logs/logs.route';
import applicationMetricsRoute from './metrics/application-metrics.route';
import serverMetricsRoute from './metrics/metrics.route';
import notificationsRoute from './notifications/notifications.route';
import inviteRoute from './organizations/invite.route';
import membershipRoute from './organizations/membership.route';
import organizationsRoute from './organizations/organizations.route';
import environmentRoute from './projects/environment.route';
import projectsRoute from './projects/projects.route';
import queueRoute from './queue/queue.route';
import heartbeatRoute from './servers/heartbeat.route';
import serversRoute from './servers/servers.route';
import usersRoute from './users/users.route';
import websocketRoute from './websocket/websocket.route';

const { router, route } = createRouter();

route('/health', healthRoute);

route('/auth', authRoute);
route('/auth/sessions', sessionRoute);
route('/auth/api-keys', apiKeyRoute);

route('/users', usersRoute);

route('/organizations', organizationsRoute);
route('/organizations/:organizationId/members', membershipRoute);
route('/organizations/:organizationId/invites', inviteRoute);
route('/organizations/:organizationId/servers', serversRoute);
route('/organizations/:organizationId/servers/:serverId/containers', containersRoute);
route(
  '/organizations/:organizationId/servers/:serverId/containers/:containerId/console',
  consoleRoute,
);
route('/organizations/:organizationId/servers/:serverId/images', imagesRoute);
route('/organizations/:organizationId/servers/:serverId/networks', networksRoute);
route('/organizations/:organizationId/servers/:serverId/volumes', volumesRoute);
route('/organizations/:organizationId/servers/:serverId/metrics', serverMetricsRoute);
route('/organizations/:organizationId/projects', projectsRoute);
route('/organizations/:organizationId/projects/:projectId/environments', environmentRoute);
route('/organizations/:organizationId/applications', applicationsRoute);
route('/organizations/:organizationId/applications/:applicationId/logs', applicationLogsRoute);
route(
  '/organizations/:organizationId/applications/:applicationId/metrics',
  applicationMetricsRoute,
);
route('/organizations/:organizationId/deployments', deploymentsRoute);
route('/organizations/:organizationId/deployments/:deploymentId/logs', deploymentLogsRoute);
route('/organizations/:organizationId/domains', domainsRoute);
route('/organizations/:organizationId/databases', databasesRoute);
route('/organizations/:organizationId/notifications', notificationsRoute);
route('/organizations/:organizationId/backups', backupsRoute);

route('/queue', queueRoute);

route('/agent', heartbeatRoute);
route('/webhooks', webhookRoute);

route('/ws', websocketRoute);

export default router;
