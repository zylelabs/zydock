import { logDebug } from '../../utils/logger';
import type {
  ComposeConfigResult,
  ComposeLogEntry,
  ComposeProjectFiles,
  ComposeProvider,
  ComposeServiceStatus,
} from './compose.contract';

type SpawnResult = { code: number; stdout: string; stderr: string };

export const projectNameOf = (project: string) => `zydock-${project}`;

const baseArgs = (project: string, files: ComposeProjectFiles) => [
  'compose',
  '-p',
  projectNameOf(project),
  ...files.composeFiles.flatMap(file => ['-f', file]),
  ...(files.envFile ? ['--env-file', files.envFile] : []),
];

const run = async (args: string[], cwd: string): Promise<SpawnResult> => {
  const process = Bun.spawn(['docker', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });

  const [stdout, stderr, code] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);

  logDebug('docker compose command', { args: args.slice(0, 3), code });

  return { code, stdout, stderr };
};

const runChecked = async (args: string[], cwd: string, description: string) => {
  const result = await run(args, cwd);

  if (result.code !== 0) {
    throw new Error(
      `${description}: ${result.stderr.trim() || 'docker compose exited with an error'}`,
    );
  }

  return result.stdout.trim();
};

const pump = async (
  readable: ReadableStream<Uint8Array>,
  stream: 'stdout' | 'stderr',
  onLog?: (entry: ComposeLogEntry) => void,
) => {
  const decoder = new TextDecoder();

  let buffer = '';

  for await (const chunk of readable) {
    buffer += decoder.decode(chunk, { stream: true });

    const lines = buffer.split('\n');

    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (line) {
        onLog?.({ stream, message: line });
      }
    }
  }

  if (buffer) {
    onLog?.({ stream, message: buffer });
  }
};

const runStreamedChecked = async (
  args: string[],
  cwd: string,
  description: string,
  onLog?: (entry: ComposeLogEntry) => void,
) => {
  const process = Bun.spawn(['docker', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });

  const [, , code] = await Promise.all([
    pump(process.stdout, 'stdout', onLog),
    pump(process.stderr, 'stderr', onLog),
    process.exited,
  ]);

  if (code !== 0) {
    throw new Error(`${description}: docker compose exited with code ${code}`);
  }
};

type ComposePsRow = {
  Name?: string;
  Service?: string;
  State?: string;
  Health?: string;
  Publishers?: { URL?: string; TargetPort?: number; PublishedPort?: number; Protocol?: string }[];
};

const parsePsOutput = (stdout: string): ComposeServiceStatus[] =>
  stdout
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => JSON.parse(line) as ComposePsRow)
    .map(row => ({
      name: row.Name ?? '',
      service: row.Service ?? '',
      state: row.State ?? 'unknown',
      health: row.Health || 'none',
      publishers: (row.Publishers ?? []).map(publisher => ({
        url: publisher.URL ?? '',
        targetPort: publisher.TargetPort ?? 0,
        publishedPort: publisher.PublishedPort,
        protocol: publisher.Protocol ?? 'tcp',
      })),
    }));

export const createComposeProvider = (): ComposeProvider => ({
  config: async (project, cwd, files): Promise<ComposeConfigResult> => {
    const result = await run([...baseArgs(project, files), 'config'], cwd);

    if (result.code !== 0) {
      return { valid: false, output: '', error: result.stderr.trim() || 'Invalid compose project' };
    }

    return { valid: true, output: result.stdout };
  },

  pull: async (project, cwd, files, onLog) => {
    await runStreamedChecked(
      [...baseArgs(project, files), 'pull'],
      cwd,
      `Failed to pull images for ${projectNameOf(project)}`,
      onLog,
    );
  },

  up: async (project, cwd, files, onLog) => {
    await runStreamedChecked(
      [...baseArgs(project, files), 'up', '--detach', '--remove-orphans'],
      cwd,
      `Failed to start ${projectNameOf(project)}`,
      onLog,
    );
  },

  down: async (project, cwd, files, removeVolumes) => {
    const args = [...baseArgs(project, files), 'down', '--remove-orphans'];

    if (removeVolumes) {
      args.push('--volumes');
    }

    await runChecked(args, cwd, `Failed to stop ${projectNameOf(project)}`);
  },

  ps: async (project, cwd, files) => {
    const raw = await runChecked(
      [...baseArgs(project, files), 'ps', '--all', '--format', 'json'],
      cwd,
      `Failed to list services of ${projectNameOf(project)}`,
    );

    return raw ? parsePsOutput(raw) : [];
  },

  restart: async (project, cwd, files, service) => {
    const args = [...baseArgs(project, files), 'restart'];

    if (service) {
      args.push(service);
    }

    await runChecked(args, cwd, `Failed to restart ${projectNameOf(project)}`);
  },

  version: async () => {
    const raw = await runChecked(
      ['compose', 'version', '--format', 'json'],
      process.cwd(),
      'Failed to read the Docker Compose version',
    );

    const parsed = JSON.parse(raw) as { version?: string };

    return parsed.version ?? raw;
  },
});
