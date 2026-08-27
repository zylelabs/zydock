import { createCipheriv, randomBytes, scryptSync } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_BYTES = 32;

export const encryptSnapshotStream = (
  passphrase: string,
  source: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> => {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = scryptSync(passphrase, salt, KEY_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const reader = source.getReader();

  let headerSent = false;
  let finished = false;

  return new ReadableStream<Uint8Array>({
    pull: async controller => {
      if (!headerSent) {
        headerSent = true;
        controller.enqueue(new Uint8Array([...salt, ...iv]));
        return;
      }

      const { done, value } = await reader.read();

      if (!done) {
        controller.enqueue(cipher.update(value));
        return;
      }

      if (!finished) {
        finished = true;
        controller.enqueue(cipher.final());
        controller.enqueue(cipher.getAuthTag());
      }

      controller.close();
    },
    cancel: () => {
      reader.cancel().catch(() => undefined);
    },
  });
};
