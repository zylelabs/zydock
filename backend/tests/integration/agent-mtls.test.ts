import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { X509Certificate } from 'node:crypto';
import { connectDatabase, disconnectDatabase } from '../../src/config/mongodb';
import agentCaModel from '../../src/modules/servers/agent-ca.model';
import {
  buildAgentTlsMaterial,
  ensureAgentCa,
  getAgentCaCertPem,
  issueServerCertificate,
} from '../../src/modules/servers/agent-ca.service';

beforeAll(async () => {
  await connectDatabase();
  await agentCaModel.deleteMany({});
});

afterAll(async () => {
  await agentCaModel.deleteMany({});
  await disconnectDatabase();
});

describe('agent CA', () => {
  test('is created once and reused on subsequent calls', async () => {
    await ensureAgentCa();
    const first = getAgentCaCertPem();

    await ensureAgentCa();
    const second = getAgentCaCertPem();

    expect(second).toBe(first);
    expect(await agentCaModel.countDocuments()).toBe(1);
  });

  test('issues a server certificate signed by the CA, with the server id as SAN', async () => {
    const serverId = 'test-server-id';
    const certificate = await issueServerCertificate(serverId);

    const cert = new X509Certificate(certificate.certPem);
    const ca = new X509Certificate(getAgentCaCertPem());

    expect(cert.issuer).toBe(ca.subject);
    expect(cert.verify(ca.publicKey)).toBe(true);
    expect(cert.subject).toContain(`CN=${serverId}`);
    expect(cert.subjectAltName).toContain(`DNS:${serverId}`);
  });
});

describe('agent mTLS channel', () => {
  test('accepts a request with the backend client certificate and refuses one without it', async () => {
    const serverId = 'test-mtls-handshake';
    const certificate = await issueServerCertificate(serverId);

    const server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch: () => new Response('ok'),
      tls: {
        cert: certificate.certPem,
        key: certificate.keyPem,
        ca: getAgentCaCertPem(),
        requestCert: true,
        rejectUnauthorized: true,
      },
    });

    try {
      const url = `https://127.0.0.1:${server.port}/`;
      const tls = buildAgentTlsMaterial(serverId);

      const authenticated = await fetch(url, { tls });

      expect(authenticated.status).toBe(200);
      expect(await authenticated.text()).toBe('ok');

      await expect(fetch(url)).rejects.toThrow();
    } finally {
      server.stop(true);
    }
  });
});
