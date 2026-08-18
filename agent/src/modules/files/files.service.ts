import config from '../../config';
import { resolveContainerProvider } from '../../providers/container';
import { limitUploadStream, normalizeVolumePath } from './files.util';

const containers = resolveContainerProvider();

const normalize = (rawPath: string) => normalizeVolumePath(rawPath, config.files.maxPathDepth);

export const listFiles = async (volume: string, rawPath: string) => {
  const entries = await containers.listVolumeFiles(volume, normalize(rawPath));

  return entries.map(entry => ({
    ...entry,
    readableAsText:
      entry.type === 'file' && (entry.sizeBytes ?? 0) <= config.files.maxReadAsTextBytes,
  }));
};

export const readFile = async (volume: string, rawPath: string) => {
  const path = normalize(rawPath);

  if (!path) {
    throw new Error('A file path is required');
  }

  return containers.readVolumeFile(volume, path);
};

export const writeFile = async (
  volume: string,
  rawPath: string,
  body: ReadableStream<Uint8Array>,
) => {
  const path = normalize(rawPath);

  if (!path) {
    throw new Error('A file path is required');
  }

  await containers.writeVolumeFile(
    volume,
    path,
    limitUploadStream(body, config.files.maxUploadBytes),
  );
};

export const removePath = async (volume: string, rawPath: string) => {
  const path = normalize(rawPath);

  if (!path) {
    throw new Error('Cannot remove the volume root');
  }

  await containers.deleteVolumePath(volume, path);
};

export const createDirectory = async (volume: string, rawPath: string) => {
  const path = normalize(rawPath);

  if (!path) {
    throw new Error('A directory path is required');
  }

  await containers.createVolumeDirectory(volume, path);
};
