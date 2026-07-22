import { createRouter } from 'hono-route-docs';
import apiKeyRoute from './auth/api-key.route';
import authRoute from './auth/auth.route';
import sessionRoute from './auth/session.route';
import healthRoute from './health/health.route';
import inviteRoute from './organizations/invite.route';
import membershipRoute from './organizations/membership.route';
import organizationsRoute from './organizations/organizations.route';
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

route('/agent', heartbeatRoute);

route('/ws', websocketRoute);

export default router;
