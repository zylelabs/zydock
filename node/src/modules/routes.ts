import { createRouter } from 'hono-route-docs';
import commandsRoute from './commands/commands.route';
import containersRoute from './containers/containers.route';
import healthRoute from './health/health.route';
import metricsRoute from './metrics/metrics.route';

const { router, route } = createRouter();

route('/health', healthRoute);
route('/metrics', metricsRoute);
route('/containers', containersRoute);
route('/commands', commandsRoute);

export default router;
