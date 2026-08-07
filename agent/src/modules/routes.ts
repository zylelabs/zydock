import { createRouter } from 'hono-route-docs';
import backupsRoute from './backups/backups.route';
import commandsRoute from './commands/commands.route';
import consoleRoute from './containers/console.route';
import containersRoute from './containers/containers.route';
import healthRoute from './health/health.route';
import imagesRoute from './images/images.route';
import metricsRoute from './metrics/metrics.route';
import networksRoute from './networks/networks.route';
import proxyAccessRoute from './proxy/proxy.access.route';
import proxyRoute from './proxy/proxy.route';
import repositoriesRoute from './repositories/repositories.route';
import updatesRoute from './updates/updates.route';
import volumesRoute from './volumes/volumes.route';

const { router, route } = createRouter();

route('/health', healthRoute);
route('/metrics', metricsRoute);
route('/containers', containersRoute);
route('/containers', consoleRoute);
route('/images', imagesRoute);
route('/networks', networksRoute);
route('/volumes', volumesRoute);
route('/proxy', proxyRoute);
route('/proxy', proxyAccessRoute);
route('/repositories', repositoriesRoute);
route('/backups', backupsRoute);
route('/commands', commandsRoute);
route('/updates', updatesRoute);

export default router;
