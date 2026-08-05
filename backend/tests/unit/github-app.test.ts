import { generateKeyPairSync, createVerify } from 'node:crypto';
import { describe, expect, test } from 'bun:test';
import { createGithubAppProvider } from '../../src/providers/git/github-app.provider';

const decodeSegment = (segment: string) =>
  JSON.parse(
    Buffer.from(segment.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
  ) as Record<string, unknown>;

describe('GitHub App JWT signing', () => {
  test('signs a JWT with the expected header, payload and signature', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    let capturedAuthorization: string | undefined;

    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      capturedAuthorization = (init?.headers as Record<string, string>).Authorization;

      return new Response(JSON.stringify([]), { status: 200 });
    }) as typeof fetch;

    try {
      const provider = createGithubAppProvider({ appId: '123', privateKey });

      await provider.listInstallations();
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(capturedAuthorization).toBeDefined();

    const token = capturedAuthorization!.replace('Bearer ', '');
    const [headerSegment, payloadSegment, signatureSegment] = token.split('.');

    const header = decodeSegment(headerSegment!);
    const payload = decodeSegment(payloadSegment!) as { iat: number; exp: number; iss: string };

    expect(header).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(payload.iss).toBe('123');
    expect(payload.exp - payload.iat).toBeLessThanOrEqual(600);

    const signingInput = `${headerSegment}.${payloadSegment}`;
    const signature = Buffer.from(
      signatureSegment!.replace(/-/g, '+').replace(/_/g, '/'),
      'base64',
    );

    const verifier = createVerify('RSA-SHA256');
    verifier.update(signingInput);

    expect(verifier.verify(publicKey, signature)).toBe(true);
  });
});
