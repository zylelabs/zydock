import { resolveRestoreProvider } from '../../providers/restore';
import { getLocalServerId } from '../servers/local-server.service';
import { buildAgentConnection, findServerById } from '../servers/server.service';
import { getInstallation, setLastRestoreRunId } from './installation.service';
import type { StartRestoreDTO } from './restore.schema';
import { downloadSnapshot } from './snapshot.service';

const localRestorer = async () => {
  const serverId = getLocalServerId();

  if (!serverId) {
    throw new Error(
      'The local server is not registered, so this installation cannot be restored from here',
    );
  }

  const server = await findServerById(serverId);

  if (!server?.agent.token) {
    throw new Error('The local server has no agent yet');
  }

  return resolveRestoreProvider(buildAgentConnection(server));
};

export const startRestore = async (payload: StartRestoreDTO) => {
  const run = await (await localRestorer()).startRun(payload);

  await setLastRestoreRunId(run.id);

  return run;
};

export const startRestoreFromSnapshot = async (
  snapshot: InstallationSnapshot,
  passphrase: string,
) => {
  const restorer = await localRestorer();
  const stream = await downloadSnapshot(snapshot);
  const { path } = await restorer.stageBundle(String(snapshot._id), stream);

  const run = await restorer.startRun({ bundlePath: path, passphrase });

  await setLastRestoreRunId(run.id);

  return run;
};

export const getLastRestoreRun = async () => {
  const installation = await getInstallation();

  if (!installation.lastRestoreRunId) {
    return null;
  }

  return (await localRestorer()).getRun(installation.lastRestoreRunId);
};
