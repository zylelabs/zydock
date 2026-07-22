import { createRouter } from 'hono-route-docs';
import applicationsRoute from './applications/applications.route';
import webhookRoute from './applications/webhook.route';
import apiKeyRoute from './auth/api-key.route';
import deploymentsRoute from './deployments/deployments.route';
import authRoute from './auth/auth.route';
import sessionRoute from './auth/session.route';
import healthRoute from './health/health.route';
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
route('/organizations/:organizationId/projects', projectsRoute);
route('/organizations/:organizationId/projects/:projectId/environments', environmentRoute);
route('/organizations/:organizationId/applications', applicationsRoute);
route('/organizations/:organizationId/deployments', deploymentsRoute);

route('/queue', queueRoute);

route('/agent', heartbeatRoute);
route('/webhooks', webhookRoute);

route('/ws', websocketRoute);

export default router;
