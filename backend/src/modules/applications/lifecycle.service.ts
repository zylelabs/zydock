import { resolveContainerProvider } from '../../providers/container';
import { logInfo } from '../../utils/logger';
import { APPLICATION_LABEL } from '../deployments/naming';
import { buildAgentConnection, findServerById } from '../servers/server.service';
import applicationModel from './application.model';

export type LifecycleAction = 'start' | 'stop' | 'restart';

const STATUS_AFTER: Record<LifecycleAction, 'running' | 'stopped'> = {
  start: 'running',
  restart: 'running',
  stop: 'stopped',
};

export const runLifecycleAction = async (application: Application, action: LifecycleAction) => {
  const server = await findServerById(String(application.serverId));

  if (!server) {
    throw new Error('Server not found');
  }

  const containers = resolveContainerProvider(buildAgentConnection(server));

  const [container] = await containers.listContainers({
    labels: { [APPLICATION_LABEL]: String(application._id) },
  });

  if (!container) {
    throw new Error('No container is running for this application; deploy it first');
  }

  if (action === 'stop') {
    await containers.stopContainer(container.id);
  } else if (action === 'start') {
    await containers.startContainer(container.id);
  } else {
    await containers.restartContainer(container.id);
  }

  await applicationModel.updateOne(
    { _id: application._id },
    { $set: { status: STATUS_AFTER[action], lastError: null } },
  );

  logInfo('Application lifecycle action', { application: String(application._id), action });
};
