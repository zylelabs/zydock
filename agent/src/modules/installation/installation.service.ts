import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import config from '../../config';
import { resolveContainerProvider } from '../../providers/container';
import {
  COMPOSE_PROJECT_LABEL,
  COMPOSE_SERVICE_LABEL,
  getOwnContainerId,
} from '../containers/protection.service';
import { readEnvFile } from '../../utils/env-file';
import { logInfo, logWarn } from '../../utils/logger';
import type { CreateInstallationBundleDTO } from './installation.schema';

const containers = resolveContainerProvider();

const COMPOSE_VOLUME_LABEL = 'com.docker.compose.volume';

const CORE_VOLUMES = ['backend-storage', 'caddy-data', 'caddy-config'] as const;

const BUNDLE_MAGIC = new TextEncoder().encode('ZYIBUN1\n');

type CapturedPart = {
  name: string;
  localPath: string;
  sizeBytes: number;
  sha256: string;
};

const snapshotsRoot = () => resolve(config.workspacePath, 'installation-snapshots');

const captureStream = async (
  tempDir: string,
  name: string,
  stream: ReadableStream<Uint8Array>,
): Promise<CapturedPart> => {
  const localPath = join(tempDir, randomUUID());
  const hash = createHash('sha256');
  const writer = Bun.file(localPath).writer();
  const reader = stream.getReader();

  let sizeBytes = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      sizeBytes += value.byteLength;
      hash.update(value);
      writer.write(value);
      await writer.flush();
    }
  } finally {
    await writer.end();
  }

  return { name, localPath, sizeBytes, sha256: hash.digest('hex') };
};

const captureBuffer = async (
  tempDir: string,
  name: string,
  data: Uint8Array,
): Promise<CapturedPart> => {
  const localPath = join(tempDir, randomUUID());

  await Bun.write(localPath, data);

  return {
    name,
    localPath,
    sizeBytes: data.byteLength,
    sha256: createHash('sha256').update(data).digest('hex'),
  };
};

const resolveOwnProject = async () => {
  const id = getOwnContainerId();
  const info = id ? await containers.inspectContainer(id) : null;
  const project = info?.labels[COMPOSE_PROJECT_LABEL];

  if (!project) {
    throw new Error('Could not resolve the compose project of this installation');
  }

  return project;
};

const findComposeContainer = async (project: string, service: string) => {
  const [found] = await containers.listContainers({
    labels: { [COMPOSE_SERVICE_LABEL]: service, [COMPOSE_PROJECT_LABEL]: project },
  });

  if (!found) {
    throw new Error(`No container found for the "${service}" service of this installation`);
  }

  return found;
};

const findComposeVolume = async (project: string, shortName: string) => {
  const volumes = await containers.listVolumes();

  return volumes.find(
    volume =>
      volume.labels[COMPOSE_VOLUME_LABEL] === shortName &&
      volume.labels[COMPOSE_PROJECT_LABEL] === project,
  );
};

const captureMongoDump = async (tempDir: string, project: string) => {
  const container = await findComposeContainer(project, 'mongo');
  const env = await readEnvFile(join(config.installPath, '.env'));

  const stream = await containers.archiveFromContainer(container.id, [
    'mongodump',
    '--archive',
    '--gzip',
    '--username',
    env.MONGO_USERNAME ?? '',
    '--password',
    env.MONGO_PASSWORD ?? '',
    '--authenticationDatabase',
    'admin',
  ]);

  return captureStream(tempDir, 'mongodump.archive.gz', stream);
};

const captureCoreVolumes = async (tempDir: string, project: string) => {
  const parts: CapturedPart[] = [];

  for (const shortName of CORE_VOLUMES) {
    const volume = await findComposeVolume(project, shortName);

    if (!volume) {
      throw new Error(`Volume "${shortName}" of this installation was not found`);
    }

    const stream = await containers.archiveVolume(volume.name);

    parts.push(await captureStream(tempDir, `volumes/${shortName}.tar.gz`, stream));
  }

  return parts;
};

const captureApplicationVolumes = async (tempDir: string, volumeNames: string[]) => {
  const parts: CapturedPart[] = [];

  for (const name of volumeNames) {
    try {
      const stream = await containers.archiveVolume(name);

      parts.push(await captureStream(tempDir, `volumes/application/${name}.tar.gz`, stream));
    } catch (error) {
      logWarn('Skipping an application volume that could not be archived for a snapshot', {
        volume: name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return parts;
};

const captureEnvFile = async (tempDir: string) => {
  const file = Bun.file(join(config.installPath, '.env'));

  if (!(await file.exists())) {
    throw new Error(`${config.installPath}/.env is missing: the snapshot would carry no secret`);
  }

  return captureBuffer(tempDir, '.env', new Uint8Array(await file.arrayBuffer()));
};

const uint32be = (value: number) => {
  const buffer = new Uint8Array(4);

  new DataView(buffer.buffer).setUint32(0, value, false);

  return buffer;
};

const uint64be = (value: number) => {
  const buffer = new Uint8Array(8);

  new DataView(buffer.buffer).setBigUint64(0, BigInt(value), false);

  return buffer;
};

async function* bundleChunks(parts: CapturedPart[], tempDir: string) {
  try {
    yield BUNDLE_MAGIC;
    yield uint32be(parts.length);

    for (const part of parts) {
      const nameBytes = new TextEncoder().encode(part.name);

      yield uint32be(nameBytes.length);
      yield nameBytes;
      yield uint64be(part.sizeBytes);

      const reader = Bun.file(part.localPath).stream().getReader();

      for (;;) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        yield value;
      }
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

const streamFromGenerator = (generator: AsyncGenerator<Uint8Array>): ReadableStream<Uint8Array> =>
  new ReadableStream({
    pull: async controller => {
      const { done, value } = await generator.next();

      if (done) {
        controller.close();
        return;
      }

      controller.enqueue(value);
    },
    cancel: () => {
      generator.return?.(undefined);
    },
  });

export const buildInstallationBundle = async (
  request: CreateInstallationBundleDTO,
): Promise<ReadableStream<Uint8Array>> => {
  const tempDir = join(snapshotsRoot(), randomUUID());

  await mkdir(tempDir, { recursive: true });

  try {
    const project = await resolveOwnProject();
    const env = await readEnvFile(join(config.installPath, '.env'));

    const parts: CapturedPart[] = [
      await captureMongoDump(tempDir, project),
      ...(await captureCoreVolumes(tempDir, project)),
      await captureEnvFile(tempDir),
    ];

    if (request.includeApplicationData && request.volumes?.length) {
      parts.push(...(await captureApplicationVolumes(tempDir, request.volumes)));
    }

    const manifest = {
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      commit: env.ZYDOCK_COMMIT ?? '',
      channel: env.ZYDOCK_CHANNEL ?? '',
      publicIp: request.publicIp ?? '',
      domain: request.domain ?? '',
      includesApplicationData: Boolean(request.includeApplicationData),
      parts: parts.map(part => ({
        name: part.name,
        sizeBytes: part.sizeBytes,
        sha256: part.sha256,
      })),
    };

    const manifestPart = await captureBuffer(
      tempDir,
      'manifest.json',
      new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
    );

    logInfo('Installation bundle assembled', {
      parts: parts.length + 1,
      includesApplicationData: manifest.includesApplicationData,
    });

    return streamFromGenerator(bundleChunks([manifestPart, ...parts], tempDir));
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
};
