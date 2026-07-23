import type { ArchiveStream } from '../providers/container';
import type { StorageProvider } from '../providers/storage';

/**
 * Writes an archive to storage as it arrives and answers how many bytes went through. An archive
 * has no known size before it is produced, and holding it in memory to measure it defeats the point
 * of streaming it.
 */
export const storeArchive = async (
  storage: StorageProvider,
  key: string,
  archive: ArchiveStream,
) => {
  let sizeBytes = 0;

  const counted = archive.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform: (chunk, controller) => {
        sizeBytes += chunk.byteLength;
        controller.enqueue(chunk);
      },
    }),
  );

  await storage.put(key, counted, { contentType: 'application/octet-stream' });

  return sizeBytes;
};
