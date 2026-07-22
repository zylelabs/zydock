import { createRouter } from 'hono-route-docs';
import commandsRoute from './commands/commands.route';
import containersRoute from './containers/containers.route';
import healthRoute from './health/health.route';
import imagesRoute from './images/images.route';
import metricsRoute from './metrics/metrics.route';
import networksRoute from './networks/networks.route';
import volumesRoute from './volumes/volumes.route';

const { router, route } = createRouter();

route('/health', healthRoute);
route('/metrics', metricsRoute);
route('/containers', containersRoute);
route('/images', imagesRoute);
route('/networks', networksRoute);
route('/volumes', volumesRoute);
route('/commands', commandsRoute);

export default router;
