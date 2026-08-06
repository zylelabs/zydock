import { describe, expect, test } from 'bun:test';
import { parseLine } from '../../src/modules/proxy/proxy.access.service';

describe('parseLine', () => {
  test('normalizes a matched access log line', () => {
    const line = JSON.stringify({
      level: 'info',
      ts: 1786045236.4555995,
      logger: 'http.log.access',
      msg: 'handled request',
      request: {
        remote_ip: '172.20.0.1',
        remote_port: '46452',
        client_ip: '172.20.0.1',
        proto: 'HTTP/1.1',
        method: 'GET',
        host: 'localhost',
        uri: '/some/path?x=1',
        headers: { 'User-Agent': ['curl/7.81.0'], Accept: ['*/*'] },
      },
      bytes_read: 0,
      duration: 0.001512371,
      size: 6,
      status: 200,
    });

    expect(parseLine(line)).toEqual({
      at: new Date(1786045236.4555995 * 1000).toISOString(),
      host: 'localhost',
      method: 'GET',
      path: '/some/path?x=1',
      status: 200,
      durationMs: 2,
      remoteIp: '172.20.0.1',
      userAgent: 'curl/7.81.0',
      size: 6,
    });
  });

  test('normalizes an unmatched request (no route for the host)', () => {
    const line = JSON.stringify({
      ts: 1786045300,
      logger: 'http.log.access',
      msg: 'NOP',
      request: { method: 'GET', host: 'unknown.example.com', uri: '/', remote_ip: '203.0.113.9' },
      duration: 0.0001,
      size: 0,
      status: 0,
    });

    expect(parseLine(line)).toMatchObject({ host: 'unknown.example.com', status: 0 });
  });

  test('discards lines from other Caddy loggers on the same stream', () => {
    const line = JSON.stringify({
      level: 'info',
      ts: 1786045236,
      logger: 'tls',
      msg: 'certificate obtained',
    });

    expect(parseLine(line)).toBeNull();
  });

  test('discards lines that are not valid JSON', () => {
    expect(parseLine('not json')).toBeNull();
  });
});
