import { logDebug } from '../../utils/logger';
import type {
  ArchiveStream,
  BuildImageSpec,
  ContainerFilter,
  ContainerHealth,
  ContainerInfo,
  ContainerProvider,
  ContainerSpec,
  ContainerState,
  ExecRequest,
  ExecResult,
  ImageInfo,
  LogEntry,
  LogQuery,
  LogStreamQuery,
  NetworkInfo,
  PortBinding,
  VolumeInfo,
} from './container.contract';

type DockerResult = {
  code: number;
  stdout: string;
  stderr: string;
};

const STATE_MAP: Record<string, ContainerState> = {
  created: 'created',
  running: 'running',
  paused: 'paused',
  restarting: 'restarting',
  exited: 'exited',
  dead: 'dead',
  removing: 'exited',
};

const run = async (args: string[]): Promise<DockerResult> => {
  const process = Bun.spawn(['docker', ...args], { stdout: 'pipe', stderr: 'pipe' });

  const [stdout, stderr, code] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);

  logDebug('docker command', { args: args.slice(0, 2), code });

  return { code, stdout, stderr };
};

const runChecked = async (args: string[], description: string) => {
  const result = await run(args);

  if (result.code !== 0) {
    throw new Error(`${description}: ${result.stderr.trim() || 'docker exited with an error'}`);
  }

  return result.stdout.trim();
};

const ARCHIVE_IMAGE = 'alpine:3';

const streamOf = async (args: string[], description: string): Promise<ArchiveStream> => {
  const process = Bun.spawn(['docker', ...args], { stdout: 'pipe', stderr: 'pipe' });

  const reader = process.stdout.getReader();

  return new ReadableStream<Uint8Array>({
    pull: async controller => {
      const { done, value } = await reader.read();

      if (!done) {
        controller.enqueue(value);
        return;
      }

      const code = await process.exited;

      if (code !== 0) {
        const stderr = await new Response(process.stderr).text();

        controller.error(new Error(`${description}: ${stderr.trim() || `exit ${code}`}`));
        return;
      }

      controller.close();
    },
    cancel: () => {
      process.kill();
    },
  });
};

const runPiped = async (args: string[], archivePath: string, description: string) => {
  const process = Bun.spawn(['docker', ...args], {
    stdin: Bun.file(archivePath),
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const [stderr, code] = await Promise.all([new Response(process.stderr).text(), process.exited]);

  if (code !== 0) {
    throw new Error(`${description}: ${stderr.trim() || `docker exited with ${code}`}`);
  }
};

const parseHealth = (raw: unknown): ContainerHealth => {
  if (raw === 'healthy' || raw === 'unhealthy' || raw === 'starting') {
    return raw;
  }

  return 'none';
};

const parsePorts = (raw: Record<string, unknown> | undefined): PortBinding[] => {
  if (!raw) {
    return [];
  }

  return Object.entries(raw).flatMap(([key, value]) => {
    const [portPart, protocol] = key.split('/');
    const containerPort = Number(portPart);

    if (!Number.isFinite(containerPort)) {
      return [];
    }

    const bindings = Array.isArray(value) ? value : [];
    const hostPort = Number((bindings[0] as { HostPort?: string })?.HostPort);

    return [
      {
        containerPort,
        hostPort: Number.isFinite(hostPort) ? hostPort : undefined,
        protocol: protocol === 'udp' ? ('udp' as const) : ('tcp' as const),
      },
    ];
  });
};

type DockerInspect = {
  Id: string;
  Name: string;
  RestartCount?: number;
  Config?: { Image?: string; Labels?: Record<string, string> };
  State?: {
    Status?: string;
    StartedAt?: string;
    FinishedAt?: string;
    ExitCode?: number;
    Health?: { Status?: string };
  };
  NetworkSettings?: { Ports?: Record<string, unknown> };
};

const toContainerInfo = (inspect: DockerInspect): ContainerInfo => ({
  id: inspect.Id,
  name: inspect.Name?.replace(/^\//, '') ?? '',
  image: inspect.Config?.Image ?? '',
  state: STATE_MAP[inspect.State?.Status ?? ''] ?? 'unknown',
  health: parseHealth(inspect.State?.Health?.Status),
  startedAt: inspect.State?.StartedAt,
  finishedAt: inspect.State?.FinishedAt,
  exitCode: inspect.State?.ExitCode,
  restartCount: inspect.RestartCount ?? 0,
  ports: parsePorts(inspect.NetworkSettings?.Ports),
  labels: inspect.Config?.Labels ?? {},
});

const inspectMany = async (ids: string[]): Promise<ContainerInfo[]> => {
  if (!ids.length) {
    return [];
  }

  const raw = await runChecked(['inspect', ...ids], 'Failed to inspect containers');

  return (JSON.parse(raw) as DockerInspect[]).map(toContainerInfo);
};

const buildCreateArgs = (spec: ContainerSpec) => {
  const args = ['create', '--name', spec.name];

  for (const [key, value] of Object.entries(spec.environment ?? {})) {
    args.push('--env', `${key}=${value}`);
  }

  for (const [key, value] of Object.entries(spec.labels ?? {})) {
    args.push('--label', `${key}=${value}`);
  }

  for (const port of spec.ports ?? []) {
    const host = port.hostPort === undefined ? '' : `${port.hostPort}:`;

    args.push('--publish', `${host}${port.containerPort}/${port.protocol}`);
  }

  for (const volume of spec.volumes ?? []) {
    args.push('--volume', `${volume.source}:${volume.target}${volume.readOnly ? ':ro' : ''}`);
  }

  for (const network of spec.networks ?? []) {
    args.push('--network', network);
  }

  if (spec.restartPolicy) {
    args.push('--restart', spec.restartPolicy);
  }

  if (spec.resources?.cpus !== undefined) {
    args.push('--cpus', String(spec.resources.cpus));
  }

  if (spec.resources?.memoryMb !== undefined) {
    args.push('--memory', `${spec.resources.memoryMb}m`);
  }

  if (spec.healthcheck) {
    args.push('--health-cmd', spec.healthcheck.command.join(' '));
    args.push('--health-interval', `${spec.healthcheck.intervalSeconds}s`);
    args.push('--health-timeout', `${spec.healthcheck.timeoutSeconds}s`);
    args.push('--health-retries', String(spec.healthcheck.retries));

    if (spec.healthcheck.startPeriodSeconds !== undefined) {
      args.push('--health-start-period', `${spec.healthcheck.startPeriodSeconds}s`);
    }
  }

  args.push(spec.image, ...(spec.command ?? []));

  return args;
};

const parseLogLine = (line: string, stream: 'stdout' | 'stderr'): LogEntry | null => {
  if (!line.trim()) {
    return null;
  }

  const separator = line.indexOf(' ');
  const timestamp = separator > 0 ? line.slice(0, separator) : '';
  const message = separator > 0 ? line.slice(separator + 1) : line;

  return {
    timestamp: Number.isNaN(Date.parse(timestamp)) ? new Date().toISOString() : timestamp,
    stream,
    message,
  };
};

const logArgs = (id: string, query: LogQuery = {}, follow = false) => {
  const args = ['logs', '--timestamps'];

  if (follow) {
    args.push('--follow');
  }

  if (query.tail !== undefined) {
    args.push('--tail', String(query.tail));
  }

  if (query.since) {
    args.push('--since', query.since);
  }

  if (query.until) {
    args.push('--until', query.until);
  }

  args.push(id);

  return args;
};

export const createDockerProvider = (): ContainerProvider => ({
  createContainer: async (spec: ContainerSpec) => {
    const id = await runChecked(buildCreateArgs(spec), `Failed to create container ${spec.name}`);
    const [info] = await inspectMany([id]);

    if (!info) {
      throw new Error(`Container ${spec.name} was created but could not be inspected`);
    }

    return info;
  },

  startContainer: async id => {
    await runChecked(['start', id], `Failed to start container ${id}`);
  },

  stopContainer: async (id, timeoutSeconds) => {
    const args = ['stop'];

    if (timeoutSeconds !== undefined) {
      args.push('--time', String(timeoutSeconds));
    }

    await runChecked([...args, id], `Failed to stop container ${id}`);
  },

  restartContainer: async id => {
    await runChecked(['restart', id], `Failed to restart container ${id}`);
  },

  removeContainer: async (id, removeVolumes) => {
    const args = ['rm', '--force'];

    if (removeVolumes) {
      args.push('--volumes');
    }

    await runChecked([...args, id], `Failed to remove container ${id}`);
  },

  inspectContainer: async id => {
    const result = await run(['inspect', id]);

    if (result.code !== 0) {
      return null;
    }

    const [info] = (JSON.parse(result.stdout) as DockerInspect[]).map(toContainerInfo);

    return info ?? null;
  },

  listContainers: async (filter: ContainerFilter = {}) => {
    const args = ['ps', '--all', '--quiet', '--no-trunc'];

    for (const [key, value] of Object.entries(filter.labels ?? {})) {
      args.push('--filter', `label=${key}=${value}`);
    }

    if (filter.state) {
      args.push('--filter', `status=${filter.state}`);
    }

    if (filter.namePrefix) {
      args.push('--filter', `name=^${filter.namePrefix}`);
    }

    const ids = (await runChecked(args, 'Failed to list containers')).split('\n').filter(Boolean);

    return inspectMany(ids);
  },

  getLogs: async (id, query) => {
    const result = await run(logArgs(id, query));

    if (result.code !== 0) {
      throw new Error(`Failed to read logs of ${id}: ${result.stderr.trim()}`);
    }

    return [
      ...result.stdout.split('\n').map(line => parseLogLine(line, 'stdout')),
      ...result.stderr.split('\n').map(line => parseLogLine(line, 'stderr')),
    ]
      .filter((entry): entry is LogEntry => entry !== null)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  },

  streamLogs: (id, query: LogStreamQuery = {}) => ({
    async *[Symbol.asyncIterator]() {
      const process = Bun.spawn(['docker', ...logArgs(id, query, true)], {
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const abort = () => process.kill();

      query.signal?.addEventListener('abort', abort, { once: true });

      try {
        const decoder = new TextDecoder();

        let buffer = '';

        for await (const chunk of process.stdout) {
          buffer += decoder.decode(chunk, { stream: true });

          const lines = buffer.split('\n');

          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const entry = parseLogLine(line, 'stdout');

            if (entry) {
              yield entry;
            }
          }
        }
      } finally {
        query.signal?.removeEventListener('abort', abort);
        process.kill();
      }
    },
  }),

  execCommand: async (id, request: ExecRequest): Promise<ExecResult> => {
    const args = ['exec'];

    if (request.workingDir) {
      args.push('--workdir', request.workingDir);
    }

    if (request.user) {
      args.push('--user', request.user);
    }

    for (const [key, value] of Object.entries(request.environment ?? {})) {
      args.push('--env', `${key}=${value}`);
    }

    const result = await run([...args, id, ...request.command]);

    return { exitCode: result.code, stdout: result.stdout, stderr: result.stderr };
  },

  buildImage: async (spec: BuildImageSpec) => {
    const args = ['build', '--tag', spec.tag];

    if (spec.dockerfilePath) {
      args.push('--file', spec.dockerfilePath);
    }

    if (spec.target) {
      args.push('--target', spec.target);
    }

    for (const [key, value] of Object.entries(spec.buildArgs ?? {})) {
      args.push('--build-arg', `${key}=${value}`);
    }

    args.push(spec.contextPath);

    const process = Bun.spawn(['docker', ...args], { stdout: 'pipe', stderr: 'pipe' });

    const decoder = new TextDecoder();

    for await (const chunk of process.stderr) {
      const message = decoder.decode(chunk, { stream: true });

      spec.onLog?.({ timestamp: new Date().toISOString(), stream: 'stderr', message });
    }

    const code = await process.exited;

    if (code !== 0) {
      throw new Error(`Failed to build image ${spec.tag}`);
    }

    const raw = await runChecked(
      ['image', 'inspect', spec.tag, '--format', '{{.Id}}|{{.Size}}|{{.Created}}'],
      `Failed to inspect image ${spec.tag}`,
    );

    const [id, size, created] = raw.split('|');

    return {
      id: id ?? spec.tag,
      tag: spec.tag,
      sizeBytes: Number(size) || 0,
      createdAt: created ?? new Date().toISOString(),
    };
  },

  pullImage: async (reference): Promise<ImageInfo> => {
    await runChecked(['pull', reference], `Failed to pull image ${reference}`);

    const raw = await runChecked(
      ['image', 'inspect', reference, '--format', '{{.Id}}|{{.Size}}|{{.Created}}'],
      `Failed to inspect image ${reference}`,
    );

    const [id, size, created] = raw.split('|');

    return {
      id: id ?? reference,
      tag: reference,
      sizeBytes: Number(size) || 0,
      createdAt: created ?? new Date().toISOString(),
    };
  },

  removeImage: async reference => {
    await runChecked(['rmi', '--force', reference], `Failed to remove image ${reference}`);
  },

  listImages: async (): Promise<ImageInfo[]> => {
    const listed = await runChecked(
      ['image', 'ls', '--all', '--quiet', '--no-trunc'],
      'Failed to list images',
    );

    const ids = [...new Set(listed.split('\n').filter(Boolean))];

    if (!ids.length) {
      return [];
    }

    const raw = await runChecked(
      [
        'image',
        'inspect',
        ...ids,
        '--format',
        '{{.Id}}|{{.Size}}|{{.Created}}|{{if .RepoTags}}{{index .RepoTags 0}}{{else}}<none>{{end}}',
      ],
      'Failed to inspect images',
    );

    return raw
      .split('\n')
      .filter(Boolean)
      .map(line => {
        const [id, size, created, tag] = line.split('|');

        return {
          id: id ?? '',
          tag: tag ?? '<none>',
          sizeBytes: Number(size) || 0,
          createdAt: created ?? '',
        };
      });
  },

  createNetwork: async (name): Promise<NetworkInfo> => {
    const existing = await run(['network', 'inspect', name, '--format', '{{.Id}}|{{.Driver}}']);

    if (existing.code === 0) {
      const [id, driver] = existing.stdout.trim().split('|');

      return { id: id ?? name, name, driver: driver ?? 'bridge' };
    }

    const id = await runChecked(['network', 'create', name], `Failed to create network ${name}`);

    return { id, name, driver: 'bridge' };
  },

  removeNetwork: async name => {
    await runChecked(['network', 'rm', name], `Failed to remove network ${name}`);
  },

  listNetworks: async () => {
    const raw = await runChecked(
      ['network', 'ls', '--format', '{{.ID}}|{{.Name}}|{{.Driver}}'],
      'Failed to list networks',
    );

    return raw
      .split('\n')
      .filter(Boolean)
      .map(line => {
        const [id, name, driver] = line.split('|');

        return { id: id ?? '', name: name ?? '', driver: driver ?? '' };
      });
  },

  createVolume: async (name): Promise<VolumeInfo> => {
    await runChecked(['volume', 'create', name], `Failed to create volume ${name}`);

    const raw = await runChecked(
      ['volume', 'inspect', name, '--format', '{{.Driver}}|{{.Mountpoint}}'],
      `Failed to inspect volume ${name}`,
    );

    const [driver, mountpoint] = raw.split('|');

    return { name, driver: driver ?? 'local', mountpoint: mountpoint ?? '' };
  },

  removeVolume: async name => {
    await runChecked(['volume', 'rm', name], `Failed to remove volume ${name}`);
  },

  listVolumes: async () => {
    const raw = await runChecked(
      ['volume', 'ls', '--format', '{{.Name}}|{{.Driver}}|{{.Mountpoint}}'],
      'Failed to list volumes',
    );

    return raw
      .split('\n')
      .filter(Boolean)
      .map(line => {
        const [name, driver, mountpoint] = line.split('|');

        return { name: name ?? '', driver: driver ?? '', mountpoint: mountpoint ?? '' };
      });
  },

  archiveVolume: async name => {
    await runChecked(['volume', 'inspect', name], `Volume ${name} not found`);

    return streamOf(
      [
        'run',
        '--rm',
        '-v',
        `${name}:/data:ro`,
        ARCHIVE_IMAGE,
        'tar',
        '-czf',
        '-',
        '-C',
        '/data',
        '.',
      ],
      `Failed to archive volume ${name}`,
    );
  },

  restoreVolume: async (name, archivePath) => {
    await runChecked(['volume', 'inspect', name], `Volume ${name} not found`);

    await runPiped(
      [
        'run',
        '--rm',
        '-i',
        '-v',
        `${name}:/data`,
        ARCHIVE_IMAGE,
        'tar',
        '-xzf',
        '-',
        '-C',
        '/data',
      ],
      archivePath,
      `Failed to restore volume ${name}`,
    );
  },

  archiveFromContainer: async (id, command) =>
    streamOf(['exec', id, ...command], `Failed to archive from container ${id}`),

  restoreIntoContainer: async (id, command, archivePath) => {
    await runPiped(['exec', '-i', id, ...command], archivePath, `Failed to restore into ${id}`);
  },
});
