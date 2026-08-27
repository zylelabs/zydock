import { createDecipheriv, createHash, scryptSync } from 'node:crypto';
import { mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const ALGORITHM = 'aes-256-gcm';
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const BUNDLE_MAGIC = new TextEncoder().encode('ZYIBUN1\n');

type ManifestPart = { name: string; sizeBytes: number; sha256: string };
type Manifest = { parts: ManifestPart[] };

const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

const readExact = async (path: string, start: number, length: number) => {
  const slice = Bun.file(path).slice(start, start + length);

  return new Uint8Array(await slice.arrayBuffer());
};

const decryptToStream = async (bundlePath: string, passphrase: string) => {
  const { size } = await stat(bundlePath);
  const cipherStart = SALT_BYTES + IV_BYTES;
  const cipherLength = size - cipherStart - TAG_BYTES;

  if (cipherLength < 0) {
    fail(`${bundlePath} is too small to be a valid Zydock snapshot bundle`);
  }

  const salt = await readExact(bundlePath, 0, SALT_BYTES);
  const iv = await readExact(bundlePath, SALT_BYTES, IV_BYTES);
  const tag = await readExact(bundlePath, size - TAG_BYTES, TAG_BYTES);
  const key = scryptSync(passphrase, salt, KEY_BYTES);

  const decipher = createDecipheriv(ALGORITHM, key, iv);

  decipher.setAuthTag(tag);

  const reader = Bun.file(bundlePath)
    .slice(cipherStart, cipherStart + cipherLength)
    .stream()
    .getReader();

  return new ReadableStream<Uint8Array>({
    pull: async controller => {
      const { done, value } = await reader.read();

      if (done) {
        try {
          const final = decipher.final();

          if (final.length > 0) {
            controller.enqueue(final);
          }
        } catch (error) {
          controller.error(
            new Error(
              `Wrong passphrase or corrupted snapshot: ${error instanceof Error ? error.message : String(error)}`,
            ),
          );
          return;
        }

        controller.close();
        return;
      }

      controller.enqueue(decipher.update(value));
    },
  });
};

const createChunkReader = (stream: ReadableStream<Uint8Array>) => {
  const reader = stream.getReader();

  let buffer = new Uint8Array(0);

  const fill = async (min: number) => {
    while (buffer.length < min) {
      const { done, value } = await reader.read();

      if (done) {
        throw new Error(
          'The bundle ended before the expected data — wrong passphrase or corrupted snapshot',
        );
      }

      const merged = new Uint8Array(buffer.length + value.length);

      merged.set(buffer, 0);
      merged.set(value, buffer.length);
      buffer = merged;
    }
  };

  const readBytes = async (length: number): Promise<Uint8Array> => {
    await fill(length);

    const out = buffer.slice(0, length);

    buffer = buffer.slice(length);

    return out;
  };

  const readUint32 = async (): Promise<number> => {
    const bytes = await readBytes(4);

    return new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, false);
  };

  const readUint64 = async (): Promise<number> => {
    const bytes = await readBytes(8);

    return Number(new DataView(bytes.buffer, bytes.byteOffset, 8).getBigUint64(0, false));
  };

  const pipeTo = async (
    length: number,
    writer: ReturnType<ReturnType<typeof Bun.file>['writer']>,
    hash: ReturnType<typeof createHash>,
  ) => {
    let remaining = length;

    while (remaining > 0) {
      if (buffer.length === 0) {
        await fill(1);
      }

      const take = Math.min(remaining, buffer.length);
      const chunk = buffer.slice(0, take);

      buffer = buffer.slice(take);
      writer.write(chunk);
      hash.update(chunk);
      remaining -= take;
    }
  };

  return { readBytes, readUint32, readUint64, pipeTo };
};

const unpackBundle = async (bundlePath: string, passphrase: string, outDir: string) => {
  const reader = createChunkReader(await decryptToStream(bundlePath, passphrase));

  const magic = await reader.readBytes(BUNDLE_MAGIC.length);

  if (!magic.every((byte, index) => byte === BUNDLE_MAGIC[index])) {
    fail('Wrong passphrase or corrupted snapshot: the bundle header is invalid');
  }

  const partCount = await reader.readUint32();

  let manifest: Manifest | undefined;

  for (let index = 0; index < partCount; index += 1) {
    const nameLength = await reader.readUint32();
    const name = new TextDecoder().decode(await reader.readBytes(nameLength));
    const size = await reader.readUint64();

    const destPath = join(outDir, name);

    await mkdir(dirname(destPath), { recursive: true });

    const hash = createHash('sha256');
    const writer = Bun.file(destPath).writer();

    await reader.pipeTo(size, writer, hash);
    await writer.end();

    if (name === 'manifest.json') {
      manifest = JSON.parse(await Bun.file(destPath).text()) as Manifest;
      continue;
    }

    const expected = manifest?.parts.find(part => part.name === name);
    const digest = hash.digest('hex');

    if (expected && expected.sha256 !== digest) {
      fail(`Checksum mismatch for ${name} — the snapshot may be corrupted`);
    }
  }

  if (!manifest) {
    fail('The bundle has no manifest.json');
  }
};

const main = async () => {
  const [, , command, ...rest] = process.argv;
  const passphrase = process.env.ZYDOCK_RESTORE_PASSPHRASE ?? '';

  if (!passphrase) {
    fail('ZYDOCK_RESTORE_PASSPHRASE is required');
  }

  if (command !== 'unpack') {
    fail(`Unknown command: ${command ?? ''}. Usage: restore-cli.ts unpack <bundlePath> <outDir>`);
  }

  const [bundlePath, outDir] = rest;

  if (!bundlePath || !outDir) {
    fail('Usage: restore-cli.ts unpack <bundlePath> <outDir>');
  }

  await mkdir(outDir, { recursive: true });
  await unpackBundle(bundlePath, passphrase, outDir);

  console.log(`Bundle unpacked to ${outDir}`);
};

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
