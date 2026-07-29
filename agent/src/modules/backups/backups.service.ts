import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import config from '../../config';

const root = resolve(config.workspacePath, 'backups');

const pathOf = (upload: string) => {
  const target = resolve(root, upload);

  if (!target.startsWith(`${root}${sep}`)) {
    throw new Error(`Invalid upload "${upload}"`);
  }

  return target;
};

export const stageUpload = async (body: ReadableStream<Uint8Array>) => {
  const id = randomUUID();

  await mkdir(root, { recursive: true });

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

export const discardUpload = async (upload: string) => {
  await rm(pathOf(upload), { force: true });
};
