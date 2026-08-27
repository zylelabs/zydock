import { createAgentClient } from '../../utils/agent';
import type {
  SnapshotBundleRequest,
  SnapshotConnection,
  SnapshotProvider,
} from './snapshot.contract';

export const createRemoteSnapshotProvider = (connection: SnapshotConnection): SnapshotProvider => {
  const { send } = createAgentClient(connection);

  return {
    streamBundle: async (request: SnapshotBundleRequest) => {
      const response = await send('/installation/snapshot', {
        method: 'POST',
        body: request,
        streamed: true,
      });

      if (!response.body) {
        throw new Error(`Agent of server ${connection.serverId} answered with no bundle`);
      }

      return response.body;
    },
  };
};
