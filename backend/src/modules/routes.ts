import { createRouter } from 'hono-route-docs';
import apiKeyRoute from './auth/api-key.route';
import authRoute from './auth/auth.route';
import sessionRoute from './auth/session.route';
import healthRoute from './health/health.route';
import usersRoute from './users/users.route';
import websocketRoute from './websocket/websocket.route';

const { router, route } = createRouter();

route('/health', healthRoute);

route('/auth', authRoute);
route('/auth/sessions', sessionRoute);
route('/auth/api-keys', apiKeyRoute);

route('/users', usersRoute);

route('/ws', websocketRoute);

export default router;
