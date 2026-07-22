import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import config from '../config';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

const key = Buffer.from(config.security.encryptionKey, 'hex');

export const encryptSecret = (plaintext: string) => {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

  return [
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
};

export const decryptSecret = (payload: string) => {
  const [iv, tag, encrypted] = payload.split('.');

  if (!iv || !tag || !encrypted) {
    throw new Error('Malformed encrypted payload');
  }

  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64url'));

  decipher.setAuthTag(Buffer.from(tag, 'base64url'));

  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
};
