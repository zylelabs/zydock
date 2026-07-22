import config from '../../config';
import { resolveSshProvider, type SshCredentials } from '../../providers/ssh';
import { decryptSecret, encryptSecret } from '../../utils/crypto';
import type { AuthPayload } from '../auth/auth.middleware';
import { isSuperuser } from '../users/user.service';
import { findMembership } from '../organizations/membership.service';
import { registerTopicAuthorizer } from '../websocket/websocket.service';
import serverModel from './server.model';

const SECRET_FIELDS = ['privateKey', 'password', 'passphrase'] as const;

export const encryptSshCredentials = (ssh: ServerSshCredentials) => {
  const encrypted: Record<string, unknown> = {
    host: ssh.host,
    port: ssh.port,
    username: ssh.username,
  };

  for (const field of SECRET_FIELDS) {
    if (ssh[field]) {
      encrypted[field] = encryptSecret(ssh[field]);
    }
  }

  return encrypted;
};

export const decryptSshCredentials = (ssh: ServerSshCredentials): SshCredentials => ({
  host: ssh.host,
  port: ssh.port,
  username: ssh.username,
  privateKey: ssh.privateKey ? decryptSecret(ssh.privateKey) : undefined,
  password: ssh.password ? decryptSecret(ssh.password) : undefined,
  passphrase: ssh.passphrase ? decryptSecret(ssh.passphrase) : undefined,
});

export const findServer = (organizationId: string, serverId: string) =>
  serverModel.findOne({ _id: serverId, organizationId });

export const findServerById = (serverId: string) =>
  serverModel.findById(serverId).select('+agent.token');

/**
 * Connection to the agent installed on the server. Requires a document loaded with the secrets —
 * the token is `select: false`.
 */
export const buildAgentConnection = (server: Server) => {
  if (!server.agent.token) {
    throw new Error(`Server ${String(server._id)} has no agent token: provision it first`);
  }

  return {
    serverId: String(server._id),
    endpoint: `http://${server.ssh.host}:${server.agent.port}`,
    token: decryptSecret(server.agent.token),
  };
};

export const findServerWithSecrets = (organizationId: string, serverId: string) =>
  serverModel
    .findOne({ _id: serverId, organizationId })
    .select('+ssh.privateKey +ssh.password +ssh.passphrase +agent.token');

export const openSshSession = async (ssh: ServerSshCredentials, expectedFingerprint?: string) =>
  resolveSshProvider().connect(decryptSshCredentials(ssh), {
    timeoutMs: config.node.requestTimeoutMs,
    expectedFingerprint,
  });

export type ConnectionProbe = {
  reachable: boolean;
  fingerprint?: string;
  osRelease?: string;
  cpuCount?: number;
  memoryMb?: number;
  diskGb?: number;
  dockerVersion?: string;
  error?: string;
};

const readNumeric = (value: string) => {
  const parsed = Number(value.trim());

  return Number.isFinite(parsed) ? parsed : undefined;
};

export const probeConnection = async (
  credentials: SshCredentials,
  expectedFingerprint?: string,
): Promise<ConnectionProbe> => {
  let session;

  try {
    session = await resolveSshProvider().connect(credentials, {
      timeoutMs: config.node.requestTimeoutMs,
      expectedFingerprint,
    });
  } catch (error) {
    return { reachable: false, error: error instanceof Error ? error.message : String(error) };
  }

  try {
    const [os, cpu, memory, disk, docker] = await Promise.all([
      session.exec('. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME" || uname -sr'),
      session.exec('nproc 2>/dev/null || echo 0'),
      session.exec("free -m 2>/dev/null | awk '/Mem:/ {print $2}' || echo 0"),
      session.exec("df -BG --output=size / 2>/dev/null | tail -1 | tr -dc '0-9' || echo 0"),
      session.exec('docker --version 2>/dev/null || true'),
    ]);

    return {
      reachable: true,
      fingerprint: session.fingerprint,
      osRelease: os.stdout.trim() || undefined,
      cpuCount: readNumeric(cpu.stdout),
      memoryMb: readNumeric(memory.stdout),
      diskGb: readNumeric(disk.stdout),
      dockerVersion: docker.stdout.trim() || undefined,
    };
  } finally {
    session.close();
  }
};

export const isAgentOnline = (server: Server) => {
  if (!server.agent.lastHeartbeatAt) {
    return false;
  }

  const elapsedSeconds = (Date.now() - server.agent.lastHeartbeatAt.getTime()) / 1000;

  return elapsedSeconds <= config.node.offlineAfterSeconds;
};

export const removeServersOfOrganization = (organizationId: string) =>
  serverModel.deleteMany({ organizationId });

export const serializeServer = (server: Server) => ({
  id: String(server._id),
  organizationId: String(server.organizationId),
  name: server.name,
  status: server.status,
  online: isAgentOnline(server),
  ssh: {
    host: server.ssh.host,
    port: server.ssh.port,
    username: server.ssh.username,
    fingerprint: server.ssh.fingerprint,
  },
  agent: {
    port: server.agent.port,
    version: server.agent.version,
    installedAt: server.agent.installedAt,
    lastHeartbeatAt: server.agent.lastHeartbeatAt,
  },
  resources: {
    cpuCount: server.resources?.cpuCount,
    memoryMb: server.resources?.memoryMb,
    diskGb: server.resources?.diskGb,
    osRelease: server.resources?.osRelease,
    dockerVersion: server.resources?.dockerVersion,
  },
  lastError: server.lastError,
  createdAt: server.createdAt,
});

const authorizeServerTopic = async (auth: AuthPayload, serverId: string) => {
  const server = await serverModel.findById(serverId);

  if (!server) {
    return false;
  }

  if (isSuperuser(auth.email)) {
    return true;
  }

  return Boolean(await findMembership(String(server.organizationId), auth.sub));
};

registerTopicAuthorizer('server', authorizeServerTopic);
