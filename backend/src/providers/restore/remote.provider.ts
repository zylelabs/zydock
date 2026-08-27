import { createAgentClient } from '../../utils/agent';
import type {
  RestoreConnection,
  RestoreProvider,
  RestoreRun,
  RestoreRunDetail,
  RestoreRunSpec,
} from './restore.contract';

export const createRemoteRestoreProvider = (connection: RestoreConnection): RestoreProvider => {
  const { send, json } = createAgentClient(connection);

  return {
    startRun: (spec: RestoreRunSpec) =>
      json<RestoreRun>('/installation/restore/runs', { method: 'POST', body: spec }),

    getRun: async (runId: string) => {
      const response = await send(`/installation/restore/runs/${encodeURIComponent(runId)}`, {
        allowedStatuses: [404],
      });

      if (response.status === 404) {
        return null;
      }

      return (await response.json()) as RestoreRunDetail;
    },

    stageBundle: (snapshotId: string, stream: ReadableStream<Uint8Array>) =>
      json<{ path: string }>(`/installation/snapshots/${encodeURIComponent(snapshotId)}/bundle`, {
        method: 'PUT',
        raw: stream,
        streamed: true,
      }),
  };
};
