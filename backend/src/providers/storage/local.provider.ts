import { createHmac } from 'node:crypto';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import config from '../../config';
import type { StorageObject, StorageProvider } from './storage.contract';

const root = resolve(config.providers.storage.localPath);

/**
 * Keeps every object inside the storage root: a key like `../../etc/passwd` resolves outside it and
 * is refused before any file is touched.
 */
const pathOf = (key: string) => {
  if (!key.trim()) {
    throw new Error('Storage key must not be empty');
  }

  const target = resolve(root, key);

  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new Error(`Invalid storage key "${key}"`);
  }

  return target;
};

const listFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);

  const nested = await Promise.all(
    entries.map(entry => {
      const path = join(directory, entry.name);

      return entry.isDirectory() ? listFiles(path) : Promise.resolve([path]);
    }),
  );

  return nested.flat();
};

const keyOf = (path: string) =>
  path
    .slice(root.length + 1)
    .split(sep)
    .join('/');

/**
 * Objects are files under `STORAGE_LOCAL_PATH`. `contentType` is not stored — the filesystem has
 * nowhere to keep it, and the contract never reads it back.
 */
export const createLocalStorageProvider = (): StorageProvider => ({
  put: async (key, data) => {
    const path = pathOf(key);

    await mkdir(dirname(path), { recursive: true });

    if (data instanceof ReadableStream) {
      await Bun.write(path, new Response(data));
    } else {
      await Bun.write(path, data);
    }
  },

  get: async key => {
    const file = Bun.file(pathOf(key));

    if (!(await file.exists())) {
      throw new Error(`Storage object "${key}" not found`);
    }

    return file.stream();
  },

  delete: async key => {
    // Removing what is already gone succeeds: deleting is idempotent.
    await rm(pathOf(key), { force: true });
  },

  list: async prefix => {
    const files = await listFiles(root);

    const objects = await Promise.all(
      files.map(async (path): Promise<StorageObject> => {
        const stats = await stat(path);

        return {
          key: keyOf(path),
          sizeBytes: stats.size,
          updatedAt: stats.mtime.toISOString(),
        };
      }),
    );

    return objects
      .filter(object => object.key.startsWith(prefix))
      .sort((a, b) => a.key.localeCompare(b.key));
  },

  exists: key => Bun.file(pathOf(key)).exists(),

  getSignedUrl: async (key, expiresInSeconds) => {
    pathOf(key);

    const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const signature = createHmac('sha256', config.jwt.secret)
      .update(`${key}:${expiresAt}`)
      .digest('hex');

    const url = new URL(`/api/storage/${key}`, config.backendUrl);

    url.searchParams.set('expires', String(expiresAt));
    url.searchParams.set('signature', signature);

    return url.toString();
  },
});
