import config from '../../config';
import { isDebugEnabled, logDebug } from '../../utils/logger';
import type {
  ArchiveStream,
  BuildImageSpec,
  ConsoleRequest,
  ConsoleSession,
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
  VolumeFileEntry,
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

  if (isDebugEnabled) {
    logDebug('docker command', { args: args.slice(0, 2), code });
  }

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

const GUARD_EXISTING = `
set -e
target="/data/$1"
[ -e "$target" ] || { echo "Path not found" >&2; exit 44; }
resolved=$(realpath "$target")
case "$resolved" in
  /data|/data/*) ;;
  *) echo "Path escapes the volume" >&2; exit 42 ;;
esac
`;

const GUARD_PARENT = `
set -e
target="/data/$1"
base="$target"
while [ ! -e "$base" ]; do base=$(dirname "$base"); done
resolved=$(realpath "$base")
case "$resolved" in
  /data|/data/*) ;;
  *) echo "Path escapes the volume" >&2; exit 42 ;;
esac
final="$resolved\${target#$base}"
`;

const LIST_VOLUME_FILES_SCRIPT = `${GUARD_EXISTING}
[ -d "$resolved" ] || { echo "Not a directory" >&2; exit 45; }
find "$resolved" -mindepth 1 -maxdepth 1 | sort | head -n "$2" | while IFS= read -r entry; do
  stat -c '%n\t%F\t%s\t%Y' "$entry"
done
`;

const READ_VOLUME_FILE_SCRIPT = `${GUARD_EXISTING}
[ -f "$resolved" ] || { echo "Not a file" >&2; exit 45; }
cat "$resolved"
`;

const DELETE_VOLUME_PATH_SCRIPT = `${GUARD_EXISTING}
[ "$resolved" = "/data" ] && { echo "Cannot remove the volume root" >&2; exit 46; }
rm -rf "$resolved"
`;

const WRITE_VOLUME_FILE_SCRIPT = `${GUARD_PARENT}
[ "$final" = "/data" ] && { echo "Cannot write to the volume root" >&2; exit 46; }
mkdir -p "$(dirname "$final")"
cat > "$final"
`;

const CREATE_VOLUME_DIRECTORY_SCRIPT = `${GUARD_PARENT}
mkdir -p "$final"
`;

const toVolumeFileEntry = (line: string): VolumeFileEntry | null => {
  const [absolutePath, fileType, size, mtime] = line.split('\t');

  if (!absolutePath) {
    return null;
  }

  const path = absolutePath.replace(/^\/data\/?/, '');

  return {
    name: path.split('/').pop() ?? path,
    path,
    type: fileType?.startsWith('directory') ? 'directory' : 'file',
    sizeBytes: Number(size) || 0,
    modifiedAt: new Date((Number(mtime) || 0) * 1000).toISOString(),
  };
};

const runVolumeScript = async (
  volume: string,
  script: string,
  args: string[],
  description: string,
  readOnly: boolean,
) => {
  await runChecked(['volume', 'inspect', volume], `Volume ${volume} not found`);

  return runChecked(
    [
      'run',
      '--rm',
      '-v',
      `${volume}:/data${readOnly ? ':ro' : ''}`,
      ARCHIVE_IMAGE,
      'sh',
      '-c',
      script,
      'sh',
      ...args,
    ],
    description,
  );
};

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

const runPipedStream = async (
  args: string[],
  stdin: ReadableStream<Uint8Array>,
  description: string,
) => {
  const process = Bun.spawn(['docker', ...args], { stdin, stdout: 'pipe', stderr: 'pipe' });

  const [stderr, code] = await Promise.all([new Response(process.stderr).text(), process.exited]);

  if (code !== 0) {
    throw new Error(`${description}: ${stderr.trim() || `docker exited with ${code}`}`);
  }
};

const DOCKER_API_ORIGIN = 'http://docker';

const HEADER_SEPARATOR = '\r\n\r\n';

const dockerApiRequest = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
  const response = await fetch(`${DOCKER_API_ORIGIN}${path}`, {
    method,
    unix: config.dockerSocketPath,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(
      `Docker API ${path} failed with ${response.status}: ${(await response.text()).trim()}`,
    );
  }

  return (response.status === 204 ? undefined : await response.json()) as T;
};

const dockerApi = <T>(path: string, body?: unknown) => dockerApiRequest<T>('POST', path, body);

const dockerApiGet = <T>(path: string) => dockerApiRequest<T>('GET', path);

const hijackConnect = async (path: string, payload: string, request: ConsoleRequest) => {
  const decoder = new TextDecoder();

  let attached = false;
  let headers = '';

  return Bun.connect({
    unix: config.dockerSocketPath,
    socket: {
      open: connection => {
        connection.write(
          `POST ${path} HTTP/1.1\r\n` +
            'Host: docker\r\n' +
            'Content-Type: application/json\r\n' +
            'Connection: Upgrade\r\n' +
            'Upgrade: tcp\r\n' +
            `Content-Length: ${Buffer.byteLength(payload)}${HEADER_SEPARATOR}${payload}`,
        );
      },
      data: (_connection, chunk) => {
        const text = decoder.decode(chunk, { stream: true });

        if (attached) {
          request.onData(text);
          return;
        }

        headers += text;

        const separator = headers.indexOf(HEADER_SEPARATOR);

        if (separator === -1) {
          return;
        }

        const output = headers.slice(separator + HEADER_SEPARATOR.length);

        attached = true;
        headers = '';

        if (output) {
          request.onData(output);
        }
      },
      close: () => request.onClose(),
      error: () => request.onClose(),
    },
  });
};

const attachExec = (execId: string, request: ConsoleRequest) =>
  hijackConnect(`/exec/${execId}/start`, JSON.stringify({ Detach: false, Tty: true }), request);

const attachContainer = (id: string, request: ConsoleRequest) =>
  hijackConnect(`/containers/${id}/attach?stream=1&stdin=1&stdout=1&stderr=1`, '', request);

const parseLabelsJson = (raw: string | undefined): Record<string, string> => {
  if (!raw) {
    return {};
  }

  try {
    return (JSON.parse(raw) as Record<string, string> | null) ?? {};
  } catch {
    return {};
  }
};

const parseLabelsList = (raw: string | undefined): Record<string, string> => {
  if (!raw) {
    return {};
  }

  return Object.fromEntries(
    raw
      .split(',')
      .filter(Boolean)
      .map(pair => {
        const separator = pair.indexOf('=');

        return separator === -1
          ? [pair, '']
          : [pair.slice(0, separator), pair.slice(separator + 1)];
      }),
  );
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
  Config?: { Image?: string; Labels?: Record<string, string>; OpenStdin?: boolean };
  State?: {
    Status?: string;
    StartedAt?: string;
    FinishedAt?: string;
    ExitCode?: number;
    Health?: { Status?: string };
  };
  NetworkSettings?: {
    Ports?: Record<string, unknown>;
    Networks?: Record<string, { IPAddress?: string }>;
  };
};

const parseAddresses = (
  raw: Record<string, { IPAddress?: string }> | undefined,
): Record<string, string> | undefined => {
  if (!raw) {
    return undefined;
  }

  const entries = Object.entries(raw).filter(([, network]) => Boolean(network.IPAddress));

  if (!entries.length) {
    return undefined;
  }

  return Object.fromEntries(entries.map(([name, network]) => [name, network.IPAddress as string]));
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
  addresses: parseAddresses(inspect.NetworkSettings?.Networks),
  stdinOpen: inspect.Config?.OpenStdin ?? false,
});

const inspectMany = async (ids: string[]): Promise<ContainerInfo[]> => {
  if (!ids.length) {
    return [];
  }

  const inspected = await Promise.all(
    ids.map(id => dockerApiGet<DockerInspect>(`/containers/${id}/json`)),
  );

  return inspected.map(toContainerInfo);
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

  updateRestartPolicy: async (id, policy) => {
    await dockerApi(`/containers/${id}/update`, { RestartPolicy: { Name: policy } });
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
    const dockerFilters: Record<string, string[]> = {};

    const labelFilters = Object.entries(filter.labels ?? {}).map(
      ([key, value]) => `${key}=${value}`,
    );

    if (labelFilters.length) {
      dockerFilters.label = labelFilters;
    }

    if (filter.state) {
      dockerFilters.status = [filter.state];
    }

    if (filter.namePrefix) {
      dockerFilters.name = [`^${filter.namePrefix}`];
    }

    const query = new URLSearchParams({ all: 'true' });

    if (Object.keys(dockerFilters).length) {
      query.set('filters', JSON.stringify(dockerFilters));
    }

    const summaries = await dockerApiGet<{ Id: string }[]>(`/containers/json?${query.toString()}`);

    return inspectMany(summaries.map(summary => summary.Id));
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

  openConsole: async (id, request: ConsoleRequest): Promise<ConsoleSession> => {
    if (request.mode === 'attach') {
      const stdinOpen = (
        await run(['inspect', '--format', '{{.Config.OpenStdin}}', id])
      ).stdout.trim();

      if (stdinOpen !== 'true') {
        throw new Error(
          'Container does not accept stdin: the template must declare stdin_open: true for Attach.',
        );
      }

      const socket = await attachContainer(id, request);

      const resize = async (columns: number, rows: number) => {
        await dockerApi(`/containers/${id}/resize?h=${rows}&w=${columns}`);
      };

      if (request.columns && request.rows) {
        await resize(request.columns, request.rows);
      }

      logDebug('docker console attached', { container: id, mode: 'attach' });

      return {
        write: data => {
          socket.write(data);
        },
        resize,
        close: () => {
          socket.end();
        },
      };
    }

    const { Id: execId } = await dockerApi<{ Id: string }>(`/containers/${id}/exec`, {
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: true,
      Cmd: [request.shell],
    });

    const socket = await attachExec(execId, request);

    const resize = async (columns: number, rows: number) => {
      await dockerApi(`/exec/${execId}/resize?h=${rows}&w=${columns}`);
    };

    if (request.columns && request.rows) {
      await resize(request.columns, request.rows);
    }

    logDebug('docker console attached', { container: id, exec: execId, mode: 'shell' });

    return {
      write: data => {
        socket.write(data);
      },
      resize,
      close: () => {
        socket.end();
      },
    };
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

    const pumpBuildOutput = async (
      readable: ReadableStream<Uint8Array>,
      stream: 'stdout' | 'stderr',
    ) => {
      const decoder = new TextDecoder();

      let buffer = '';

      for await (const chunk of readable) {
        buffer += decoder.decode(chunk, { stream: true });

        const lines = buffer.split('\n');

        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line) {
            spec.onLog?.({ timestamp: new Date().toISOString(), stream, message: line });
          }
        }
      }

      if (buffer) {
        spec.onLog?.({ timestamp: new Date().toISOString(), stream, message: buffer });
      }
    };

    await Promise.all([
      pumpBuildOutput(process.stdout, 'stdout'),
      pumpBuildOutput(process.stderr, 'stderr'),
    ]);

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
    const existing = await run([
      'network',
      'inspect',
      name,
      '--format',
      '{{.Id}}|{{.Driver}}|{{json .Labels}}',
    ]);

    if (existing.code === 0) {
      const [id, driver, ...labelParts] = existing.stdout.trim().split('|');

      return {
        id: id ?? name,
        name,
        driver: driver ?? 'bridge',
        labels: parseLabelsJson(labelParts.join('|')),
      };
    }

    const id = await runChecked(['network', 'create', name], `Failed to create network ${name}`);

    return { id, name, driver: 'bridge', labels: {} };
  },

  removeNetwork: async name => {
    await runChecked(['network', 'rm', name], `Failed to remove network ${name}`);
  },

  listNetworks: async () => {
    const raw = await runChecked(
      ['network', 'ls', '--format', '{{.ID}}|{{.Name}}|{{.Driver}}|{{json .Labels}}'],
      'Failed to list networks',
    );

    return raw
      .split('\n')
      .filter(Boolean)
      .map(line => {
        const [id, name, driver, ...labelParts] = line.split('|');

        return {
          id: id ?? '',
          name: name ?? '',
          driver: driver ?? '',
          labels: parseLabelsJson(labelParts.join('|')),
        };
      });
  },

  createVolume: async (name): Promise<VolumeInfo> => {
    await runChecked(
      ['volume', 'create', '--label', 'zydock.managed=true', name],
      `Failed to create volume ${name}`,
    );

    const raw = await runChecked(
      ['volume', 'inspect', name, '--format', '{{.Driver}}|{{.Mountpoint}}|{{json .Labels}}'],
      `Failed to inspect volume ${name}`,
    );

    const [driver, mountpoint, ...labelParts] = raw.split('|');

    return {
      name,
      driver: driver ?? 'local',
      mountpoint: mountpoint ?? '',
      labels: parseLabelsJson(labelParts.join('|')),
    };
  },

  removeVolume: async name => {
    await runChecked(['volume', 'rm', name], `Failed to remove volume ${name}`);
  },

  listVolumes: async () => {
    const raw = await runChecked(
      ['volume', 'ls', '--format', '{{.Name}}|{{.Driver}}|{{.Mountpoint}}|{{.Labels}}'],
      'Failed to list volumes',
    );

    return raw
      .split('\n')
      .filter(Boolean)
      .map(line => {
        const [name, driver, mountpoint, ...labelParts] = line.split('|');

        return {
          name: name ?? '',
          driver: driver ?? '',
          mountpoint: mountpoint ?? '',
          labels: parseLabelsList(labelParts.join('|')),
        };
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

  listVolumeFiles: async (name, path): Promise<VolumeFileEntry[]> => {
    const output = await runVolumeScript(
      name,
      LIST_VOLUME_FILES_SCRIPT,
      [path, String(config.files.maxListEntries)],
      `Failed to list files of volume ${name}`,
      true,
    );

    return output
      .split('\n')
      .filter(Boolean)
      .map(toVolumeFileEntry)
      .filter((entry): entry is VolumeFileEntry => entry !== null);
  },

  readVolumeFile: async (name, path) => {
    await runChecked(['volume', 'inspect', name], `Volume ${name} not found`);

    return streamOf(
      [
        'run',
        '--rm',
        '-v',
        `${name}:/data:ro`,
        ARCHIVE_IMAGE,
        'sh',
        '-c',
        READ_VOLUME_FILE_SCRIPT,
        'sh',
        path,
      ],
      `Failed to read file from volume ${name}`,
    );
  },

  writeVolumeFile: async (name, path, stream) => {
    await runChecked(['volume', 'inspect', name], `Volume ${name} not found`);

    await runPipedStream(
      [
        'run',
        '--rm',
        '-i',
        '-v',
        `${name}:/data`,
        ARCHIVE_IMAGE,
        'sh',
        '-c',
        WRITE_VOLUME_FILE_SCRIPT,
        'sh',
        path,
      ],
      stream,
      `Failed to write file to volume ${name}`,
    );
  },

  deleteVolumePath: async (name, path) => {
    await runVolumeScript(
      name,
      DELETE_VOLUME_PATH_SCRIPT,
      [path],
      `Failed to remove path from volume ${name}`,
      false,
    );
  },

  createVolumeDirectory: async (name, path) => {
    await runVolumeScript(
      name,
      CREATE_VOLUME_DIRECTORY_SCRIPT,
      [path],
      `Failed to create directory in volume ${name}`,
      false,
    );
  },
});
