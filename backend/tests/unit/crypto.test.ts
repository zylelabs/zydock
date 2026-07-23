import { describe, expect, test } from 'bun:test';
import { decryptSecret, encryptSecret } from '../../src/utils/crypto';

describe('crypto (AES-256-GCM)', () => {
  test('a round-trip recovers the plaintext', () => {
    const secret = 'super-secret-value-123';

    expect(decryptSecret(encryptSecret(secret))).toBe(secret);
  });

  test('two encryptions of the same value differ (random IV)', () => {
    expect(encryptSecret('same')).not.toBe(encryptSecret('same'));
  });

  test('a tampered payload fails authentication', () => {
    const payload = encryptSecret('do-not-touch');
    const [iv, tag, data] = payload.split('.');
    // Flip the last character of the ciphertext.
    const tampered = `${iv}.${tag}.${data!.slice(0, -1)}${data!.at(-1) === 'A' ? 'B' : 'A'}`;

    expect(() => decryptSecret(tampered)).toThrow();
  });

  test('a malformed payload is rejected', () => {
    expect(() => decryptSecret('not-a-valid-payload')).toThrow('Malformed encrypted payload');
  });
});
