import type { ArchiveStream } from '../providers/container';
import type { StorageProvider } from '../providers/storage';

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
