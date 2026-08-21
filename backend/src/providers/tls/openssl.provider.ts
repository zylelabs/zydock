import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CertificateAuthority, IssuedCertificate, TlsProvider } from './tls.contract';

const CA_DAYS = 3650;
const CERT_DAYS = 825;

const runOpenssl = async (argv: string[], cwd: string) => {
  const process = Bun.spawn(['openssl', ...argv], { cwd, stdout: 'pipe', stderr: 'pipe' });

  const [stderr, exitCode] = await Promise.all([
    new Response(process.stderr).text(),
    process.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(`openssl ${argv[0]} failed: ${stderr.trim() || `exit code ${exitCode}`}`);
  }
};

const withScratchDir = async <T>(fn: (dir: string) => Promise<T>): Promise<T> => {
  const dir = await mkdtemp(join(tmpdir(), 'zydock-tls-'));

  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

const extensionsFile = (commonName: string) =>
  [
    `subjectAltName=DNS:${commonName}`,
    'basicConstraints=CA:FALSE',
    'keyUsage=digitalSignature,keyEncipherment',
    'extendedKeyUsage=serverAuth,clientAuth',
    '',
  ].join('\n');

export const createOpensslTlsProvider = (): TlsProvider => ({
  createCertificateAuthority: commonName =>
    withScratchDir(async dir => {
      const keyPath = join(dir, 'ca.key');
      const certPath = join(dir, 'ca.crt');

      await runOpenssl(['genrsa', '-out', keyPath, '4096'], dir);
      await runOpenssl(
        [
          'req',
          '-x509',
          '-new',
          '-key',
          keyPath,
          '-sha256',
          '-days',
          String(CA_DAYS),
          '-out',
          certPath,
          '-subj',
          `/CN=${commonName}`,
          '-addext',
          'basicConstraints=critical,CA:TRUE',
          '-addext',
          'keyUsage=critical,keyCertSign,cRLSign',
        ],
        dir,
      );

      const [certPem, keyPem] = await Promise.all([
        Bun.file(certPath).text(),
        Bun.file(keyPath).text(),
      ]);

      return { certPem, keyPem };
    }),

  issueCertificate: (commonName, authority: CertificateAuthority): Promise<IssuedCertificate> =>
    withScratchDir(async dir => {
      const caCertPath = join(dir, 'ca.crt');
      const caKeyPath = join(dir, 'ca.key');
      const keyPath = join(dir, 'server.key');
      const csrPath = join(dir, 'server.csr');
      const certPath = join(dir, 'server.crt');
      const extFilePath = join(dir, 'server.ext');

      await Promise.all([
        writeFile(caCertPath, authority.certPem),
        writeFile(caKeyPath, authority.keyPem),
        writeFile(extFilePath, extensionsFile(commonName)),
      ]);

      await runOpenssl(['genrsa', '-out', keyPath, '2048'], dir);
      await runOpenssl(
        [
          'req',
          '-new',
          '-key',
          keyPath,
          '-out',
          csrPath,
          '-subj',
          `/CN=${commonName}`,
          '-addext',
          `subjectAltName=DNS:${commonName}`,
        ],
        dir,
      );
      await runOpenssl(
        [
          'x509',
          '-req',
          '-in',
          csrPath,
          '-CA',
          caCertPath,
          '-CAkey',
          caKeyPath,
          '-CAcreateserial',
          '-out',
          certPath,
          '-days',
          String(CERT_DAYS),
          '-sha256',
          '-extfile',
          extFilePath,
        ],
        dir,
      );

      const [certPem, keyPem] = await Promise.all([
        Bun.file(certPath).text(),
        Bun.file(keyPath).text(),
      ]);

      return { certPem, keyPem };
    }),
});
