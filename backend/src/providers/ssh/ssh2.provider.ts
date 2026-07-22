import { createHash } from 'node:crypto';
import { Client } from 'ssh2';
import type {
  SshConnectOptions,
  SshCredentials,
  SshExecResult,
  SshProvider,
  SshSession,
} from './ssh.contract';

const DEFAULT_TIMEOUT_MS = 15000;

const fingerprintOf = (hostKey: Buffer) =>
  `SHA256:${createHash('sha256').update(hostKey).digest('base64').replace(/=+$/, '')}`;

const execOn = (client: Client, command: string) =>
  new Promise<SshExecResult>((resolve, reject) => {
    client.exec(command, (error, stream) => {
      if (error) {
        reject(new Error(`SSH command failed to start: ${error.message}`));
        return;
      }

      let stdout = '';
      let stderr = '';

      stream.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });

      stream.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });

      stream.on('close', (code: number | null) => {
        resolve({ code: code ?? 0, stdout, stderr });
      });
    });
  });

const uploadOn = (
  client: Client,
  remotePath: string,
  content: string | Uint8Array,
  mode?: number,
) =>
  new Promise<void>((resolve, reject) => {
    client.sftp((error, sftp) => {
      if (error) {
        reject(new Error(`SFTP session failed: ${error.message}`));
        return;
      }

      const buffer =
        typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content);

      sftp.writeFile(remotePath, buffer, writeError => {
        if (writeError) {
          reject(new Error(`Failed to upload ${remotePath}: ${writeError.message}`));
          return;
        }

        if (mode === undefined) {
          resolve();
          return;
        }

        sftp.chmod(remotePath, mode, chmodError => {
          if (chmodError) {
            reject(new Error(`Failed to set permissions on ${remotePath}: ${chmodError.message}`));
            return;
          }

          resolve();
        });
      });
    });
  });

export const createSsh2Provider = (): SshProvider => ({
  connect: (credentials: SshCredentials, options: SshConnectOptions = {}) =>
    new Promise<SshSession>((resolve, reject) => {
      const client = new Client();
      const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

      let fingerprint = '';
      let settled = false;

      const fail = (message: string) => {
        if (settled) {
          return;
        }

        settled = true;
        client.end();
        reject(new Error(message));
      };

      client.on('ready', () => {
        if (settled) {
          return;
        }

        settled = true;

        resolve({
          fingerprint,
          exec: command => execOn(client, command),
          uploadFile: (remotePath, content, mode) => uploadOn(client, remotePath, content, mode),
          close: () => client.end(),
        });
      });

      client.on('error', error => {
        fail(`SSH connection failed: ${error.message}`);
      });

      client.on('timeout', () => {
        fail('SSH connection timed out');
      });

      client.on('keyboard-interactive', (_name, _instructions, _lang, prompts, finish) => {
        if (!credentials.password) {
          finish([]);
          return;
        }

        finish(prompts.map(() => credentials.password as string));
      });

      client.connect({
        host: credentials.host,
        port: credentials.port,
        username: credentials.username,
        privateKey: credentials.privateKey,
        passphrase: credentials.passphrase,
        password: credentials.password,
        tryKeyboard: Boolean(credentials.password),
        readyTimeout: timeoutMs,
        hostVerifier: (hostKey: Buffer) => {
          fingerprint = fingerprintOf(hostKey);

          if (!options.expectedFingerprint) {
            return true;
          }

          return options.expectedFingerprint === fingerprint;
        },
      });
    }),
});
