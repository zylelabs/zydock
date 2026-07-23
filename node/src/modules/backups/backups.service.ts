import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import config from '../../config';

const root = resolve(config.workspacePath, 'backups');

/** An upload id is generated here, but the resolved path is checked against the root anyway. */
const pathOf = (upload: string) => {
  const target = resolve(root, upload);

  if (!target.startsWith(`${root}${sep}`)) {
    throw new Error(`Invalid upload "${upload}"`);
  }

  return target;
};

/**
 * Stages an archive on this host. A restore needs the bytes *and* the command that consumes them;
 * staging first keeps the command in a JSON body instead of a query string or a header.
 */
export const stageUpload = async (body: ReadableStream<Uint8Array>) => {
  const id = randomUUID();

  await mkdir(root, { recursive: true });

  // Chunk by chunk, and never `Bun.write(path, new Response(body))`: a request body with no length
  // — an archive as it is uploaded — makes that call wait forever for a size that never comes.
  const reader = body.getReader();
  const writer = Bun.file(join(root, id)).writer();

  let sizeBytes = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      sizeBytes += value.byteLength;
      writer.write(value);
      await writer.flush();
    }
  } finally {
    await writer.end();
  }

  return { id, sizeBytes };
};

export const uploadPath = (upload: string) => pathOf(upload);

export const uploadExists = (upload: string) => Bun.file(pathOf(upload)).exists();

/** A staged archive is disposable: it is removed as soon as the restore that needed it is over. */
export const discardUpload = async (upload: string) => {
  await rm(pathOf(upload), { force: true });
};
