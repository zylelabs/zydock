import { createAgentClient, readAgentEvents, searchParams } from '../../utils/agent';
import type {
  ComposeConfigResult,
  ComposeConnection,
  ComposeFile,
  ComposeLogEntry,
  ComposeProvider,
  ComposeServiceStatus,
} from './compose.contract';

const runStreamed = async (
  path: string,
  connection: ComposeConnection,
  description: string,
  onLog?: (entry: ComposeLogEntry) => void,
) => {
  const { send } = createAgentClient(connection);

  const response = await send(path, { method: 'POST', streamed: true });

  let failure: string | null = null;

  for await (const entry of readAgentEvents(response)) {
    if (entry.event === 'log') {
      onLog?.(JSON.parse(entry.data) as ComposeLogEntry);
    } else if (entry.event === 'error') {
      failure = (JSON.parse(entry.data) as { error: string }).error;
    }
  }

  if (failure) {
    throw new Error(`${description}: ${failure}`);
  }
};

export const createRemoteComposeProvider = (connection: ComposeConnection): ComposeProvider => {
  const { json, discard } = createAgentClient(connection);

  const projectPath = (project: string) => `/compose/${encodeURIComponent(project)}`;

  return {
    writeFiles: (project, files: ComposeFile[]) =>
      discard(`${projectPath(project)}/files`, { method: 'POST', body: { files } }),

    config: project => json<ComposeConfigResult>(`${projectPath(project)}/config`),

    pull: (project, onLog) =>
      runStreamed(
        `${projectPath(project)}/pull`,
        connection,
        `Failed to pull images for the compose project`,
        onLog,
      ),

    up: (project, onLog) =>
      runStreamed(
        `${projectPath(project)}/up`,
        connection,
        `Failed to start the compose project`,
        onLog,
      ),

    down: (project, removeVolumes) =>
      discard(`${projectPath(project)}/down`, {
        method: 'POST',
        query: searchParams({ volumes: removeVolumes ? 'true' : undefined }),
      }),

    ps: project => json<ComposeServiceStatus[]>(`${projectPath(project)}/ps`),

    restart: (project, service) =>
      discard(`${projectPath(project)}/restart`, {
        method: 'POST',
        query: searchParams({ service }),
      }),
  };
};
