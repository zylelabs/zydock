import { createAgentClient } from '../../utils/agent';
import type {
  UpdateRun,
  UpdateRunDetail,
  UpdateRunSpec,
  UpdaterConnection,
  UpdaterProvider,
} from './updater.contract';

export const createRemoteUpdaterProvider = (connection: UpdaterConnection): UpdaterProvider => {
  const { send, json } = createAgentClient(connection);

  return {
    startRun: (spec: UpdateRunSpec) =>
      json<UpdateRun>('/updates/runs', { method: 'POST', body: spec }),

    getRun: async (runId: string) => {
      const response = await send(`/updates/runs/${encodeURIComponent(runId)}`, {
        allowedStatuses: [404],
      });

      if (response.status === 404) {
        return null;
      }

      return (await response.json()) as UpdateRunDetail;
    },
  };
};
