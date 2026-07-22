import { createRouter } from 'hono-route-docs';
import healthRoute from './health/health.route';
import websocketRoute from './websocket/websocket.route';

const { router, route } = createRouter();

route('/health', healthRoute);
route('/ws', websocketRoute);

export default router;
