import { file } from 'bun';
import type { Document } from 'mongoose';
import { createHash } from 'node:crypto';
import config from '../../config';
import type { SshSession } from '../../providers/ssh';
import { decryptSecret, encryptSecret } from '../../utils/crypto';
import { logError, logInfo, logWarn } from '../../utils/logger';
import { enqueueJob, registerJobHandler } from '../queue/queue.service';
import { publish } from '../websocket/websocket.service';
import { getAgentCaCertPem, issueServerCertificate } from './agent-ca.service';
import serverModel from './server.model';
import {
  decryptSshCredentials,
  generateAgentToken,
  openSshSession,
  probeConnection,
} from './server.service';

const AGENT_DIR = '/opt/zydock';
const AGENT_ENV_DIR = '/etc/zydock';
const AGENT_BUNDLE = `${AGENT_DIR}/agent.js`;
const AGENT_ENV_FILE = `${AGENT_ENV_DIR}/agent.env`;
const AGENT_UNIT = '/etc/systemd/system/zydock-agent.service';
const AGENT_TLS_DIR = `${AGENT_ENV_DIR}/tls`;
const AGENT_TLS_CA = `${AGENT_TLS_DIR}/ca.pem`;
const AGENT_TLS_CERT = `${AGENT_TLS_DIR}/agent-cert.pem`;
const AGENT_TLS_KEY = `${AGENT_TLS_DIR}/agent-key.pem`;

export type ProvisioningStep =
  | 'connect'
  | 'install-docker'
  | 'install-runtime'
  | 'install-proxy'
  | 'upload-agent'
  | 'configure-agent'
  | 'secure-network'
  | 'start-agent'
  | 'verify-agent';

const PROXY_CONTAINER = 'zydock-proxy';
const PROXY_CADDYFILE = `${AGENT_ENV_DIR}/Caddyfile`;

export type ProvisioningResult = {
  step: ProvisioningStep;
  ok: boolean;
  detail?: string;
};

const publishStep = (serverId: string, result: ProvisioningResult) => {
  publish(`server:${serverId}:provisioning`, 'provisioning.step', result);
};

const runChecked = async (session: SshSession, command: string, description: string) => {
  const result = await session.exec(command);

  if (result.code !== 0) {
    throw new Error(`${description}: ${result.stderr.trim() || result.stdout.trim() || 'failed'}`);
  }

  return result.stdout.trim();
};

const detectPrivilegePrefix = async (session: SshSession) => {
  const whoami = await session.exec('id -u');

  if (whoami.stdout.trim() === '0') {
    return '';
  }

  const sudo = await session.exec('sudo -n true 2>/dev/null && echo ok || true');

  if (sudo.stdout.trim() !== 'ok') {
    throw new Error('The SSH user is not root and cannot use passwordless sudo');
  }

  return 'sudo ';
};

const installDocker = (prefix: string) => `
set -e
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com -o /tmp/zydock-get-docker.sh
  ${prefix}sh /tmp/zydock-get-docker.sh
  rm -f /tmp/zydock-get-docker.sh
fi
${prefix}systemctl enable --now docker
docker --version
`;

const installGit = (prefix: string) => `
set -e
if ! command -v git >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    ${prefix}apt-get update -qq
    ${prefix}DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git
  elif command -v dnf >/dev/null 2>&1; then
    ${prefix}dnf install -y -q git
  elif command -v yum >/dev/null 2>&1; then
    ${prefix}yum install -y -q git
  elif command -v apk >/dev/null 2>&1; then
    ${prefix}apk add --no-cache git
  else
    echo "No supported package manager found to install git" >&2
    exit 1
  fi
fi
git --version
`;

const installRuntime = (prefix: string) => `
set -e
if ! command -v bun >/dev/null 2>&1 && [ ! -x /usr/local/bin/bun ]; then
  curl -fsSL https://bun.sh/install | bash
  ${prefix}install -m 0755 "$HOME/.bun/bin/bun" /usr/local/bin/bun
fi
/usr/local/bin/bun --version
`;

const installProxy = (prefix: string, network: string) => `
set -e
docker network inspect ${network} >/dev/null 2>&1 || docker network create ${network}
${prefix}mkdir -p ${AGENT_ENV_DIR}
${prefix}tee ${PROXY_CADDYFILE} >/dev/null <<'EOF'
{
	admin 0.0.0.0:2019
}
EOF
if [ -z "$(docker ps -q -f name=^/${PROXY_CONTAINER}$)" ]; then
  docker rm -f ${PROXY_CONTAINER} >/dev/null 2>&1 || true
  docker run -d --name ${PROXY_CONTAINER} --restart unless-stopped \\
    --network ${network} \\
    -p 80:80 -p 443:443 -p 127.0.0.1:2019:2019 \\
    -v zydock-caddy-data:/data -v zydock-caddy-config:/config \\
    -v ${PROXY_CADDYFILE}:/etc/caddy/Caddyfile:ro \\
    caddy:2 caddy run --config /etc/caddy/Caddyfile --adapter caddyfile --resume
fi
docker inspect -f '{{.State.Status}}' ${PROXY_CONTAINER}
`;

const systemdUnit = () => `[Unit]
Description=Zydock Agent
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=${AGENT_ENV_FILE}
ExecStart=/usr/local/bin/bun run ${AGENT_BUNDLE}
Restart=always
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
`;

const agentEnvFile = (params: {
  serverId: string;
  token: string;
  port: number;
}) => `PORT="${params.port}"
BIND_HOST="0.0.0.0"
MODE="prod"
LOG_LEVEL="info"
SERVER_ID="${params.serverId}"
AGENT_TOKEN="${params.token}"
BACKEND_URL="${config.backendUrl}"
WORKSPACE_PATH="${config.deploy.workspacePath}"
TLS_CERT_PATH="${AGENT_TLS_CERT}"
TLS_KEY_PATH="${AGENT_TLS_KEY}"
TLS_CA_PATH="${AGENT_TLS_CA}"
`;

const uploadAgentTls = async (session: SshSession, prefix: string, serverId: string) => {
  const certificate = await issueServerCertificate(serverId);

  await runChecked(
    session,
    `${prefix}mkdir -p ${AGENT_TLS_DIR} && ${prefix}chmod 700 ${AGENT_TLS_DIR}`,
    'Failed to create the agent TLS directory',
  );
  await session.uploadFile(AGENT_TLS_CA, getAgentCaCertPem(), 0o644);
  await session.uploadFile(AGENT_TLS_CERT, certificate.certPem, 0o644);
  await session.uploadFile(AGENT_TLS_KEY, certificate.keyPem, 0o600);
};

const resolveBackendIp = async (session: SshSession) => {
  const backendHost = new URL(config.backendUrl).hostname;
  const result = await session.exec(`getent hosts ${backendHost} | awk '{print $1}' | head -n1`);
  const backendIp = result.stdout.trim();

  if (!backendIp) {
    throw new Error(
      `Could not resolve the backend host "${backendHost}" from the managed server: the ` +
        'agent port could not be restricted to it',
    );
  }

  return backendIp;
};

const secureNetwork = (prefix: string, backendIp: string, port: number) => `
set -e
if command -v ufw >/dev/null 2>&1; then
  ${prefix}ufw allow from ${backendIp} to any port ${port} proto tcp comment zydock-agent
  ${prefix}ufw --force enable >/dev/null 2>&1 || true
  ${prefix}ufw deny ${port}/tcp comment zydock-agent-deny-all || true
elif command -v iptables >/dev/null 2>&1; then
  ${prefix}iptables -C INPUT -p tcp --dport ${port} -s ${backendIp} -j ACCEPT 2>/dev/null || \\
    ${prefix}iptables -I INPUT -p tcp --dport ${port} -s ${backendIp} -j ACCEPT
  ${prefix}iptables -C INPUT -p tcp --dport ${port} -j DROP 2>/dev/null || \\
    ${prefix}iptables -A INPUT -p tcp --dport ${port} -j DROP
else
  echo "Neither ufw nor iptables was found: the agent port was not restricted" >&2
  exit 1
fi
`;

type AgentBundle = { content: string; hash: string };

const readAgentBundle = async (): Promise<AgentBundle> => {
  const bundle = file(config.agent.bundlePath);

  if (!(await bundle.exists())) {
    throw new Error(
      `Agent bundle not found at "${config.agent.bundlePath}". Run "bun run build" inside agent/.`,
    );
  }

  const content = await bundle.text();

  return { content, hash: createHash('sha256').update(content).digest('hex') };
};

const healthCheck = (port: number, tlsEnabled: boolean) =>
  tlsEnabled
    ? `curl -fsS -m 10 --retry 10 --retry-delay 2 --retry-connrefused --cacert ${AGENT_TLS_CA} ` +
      `--cert ${AGENT_TLS_CERT} --key ${AGENT_TLS_KEY} -k https://127.0.0.1:${port}/api/health`
    : `curl -fsS -m 10 --retry 10 --retry-delay 2 --retry-connrefused http://127.0.0.1:${port}/api/health`;

export const provisionServer = async (server: Server & Document) => {
  const serverId = String(server._id);
  const results: ProvisioningResult[] = [];

  const record = (result: ProvisioningResult) => {
    results.push(result);
    publishStep(serverId, result);
  };

  let session: SshSession | undefined;
  let currentStep: ProvisioningStep = 'connect';

  try {
    await serverModel.updateOne(
      { _id: serverId },
      { $set: { status: 'provisioning', lastError: null } },
    );

    session = await openSshSession(server.ssh, server.ssh.fingerprint);
    record({ step: 'connect', ok: true, detail: session.fingerprint });

    currentStep = 'install-docker';

    const prefix = await detectPrivilegePrefix(session);

    const dockerVersion = await runChecked(
      session,
      installDocker(prefix),
      'Failed to install Docker',
    );
    record({ step: 'install-docker', ok: true, detail: dockerVersion });

    currentStep = 'install-runtime';

    const runtimeVersion = await runChecked(
      session,
      installRuntime(prefix),
      'Failed to install the Bun runtime',
    );

    const gitVersion = await runChecked(session, installGit(prefix), 'Failed to install git');

    record({ step: 'install-runtime', ok: true, detail: `${runtimeVersion} · ${gitVersion}` });

    currentStep = 'install-proxy';

    const proxyStatus = await runChecked(
      session,
      installProxy(prefix, config.proxy.network),
      'Failed to start the reverse proxy',
    );
    record({ step: 'install-proxy', ok: true, detail: proxyStatus });

    currentStep = 'upload-agent';

    const bundle = await readAgentBundle();

    await runChecked(
      session,
      `${prefix}mkdir -p ${AGENT_DIR} ${AGENT_ENV_DIR} ${config.deploy.workspacePath} && ${prefix}chmod 700 ${AGENT_ENV_DIR}`,
      'Failed to create the agent directories',
    );
    await session.uploadFile(AGENT_BUNDLE, bundle.content, 0o755);
    record({ step: 'upload-agent', ok: true });

    currentStep = 'configure-agent';

    const token = generateAgentToken();

    await uploadAgentTls(session, prefix, serverId);
    await session.uploadFile(
      AGENT_ENV_FILE,
      agentEnvFile({ serverId, token, port: server.agent.port }),
      0o600,
    );
    await session.uploadFile(AGENT_UNIT, systemdUnit(), 0o644);
    record({ step: 'configure-agent', ok: true });

    currentStep = 'secure-network';

    const backendIp = await resolveBackendIp(session);

    await runChecked(
      session,
      secureNetwork(prefix, backendIp, server.agent.port),
      'Failed to restrict the agent port to the backend',
    );
    record({ step: 'secure-network', ok: true, detail: backendIp });

    currentStep = 'start-agent';

    await runChecked(
      session,
      `${prefix}systemctl daemon-reload && ${prefix}systemctl enable --now zydock-agent`,
      'Failed to start the agent service',
    );
    record({ step: 'start-agent', ok: true });

    currentStep = 'verify-agent';

    const health = await runChecked(
      session,
      healthCheck(server.agent.port, true),
      'The agent did not answer its health check',
    );
    record({ step: 'verify-agent', ok: true, detail: health });

    await serverModel.updateOne(
      { _id: serverId },
      {
        $set: {
          status: 'online',
          'agent.token': encryptSecret(token),
          'agent.installedAt': new Date(),
          'agent.bundleHash': bundle.hash,
          'agent.tlsIssuedAt': new Date(),
          lastError: null,
        },
      },
    );

    logInfo('Server provisioned', { serverId });

    return results;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    record({ step: currentStep, ok: false, detail: message });

    await serverModel.updateOne(
      { _id: serverId },
      { $set: { status: 'failed', lastError: message } },
    );

    logError('Server provisioning failed', error, { serverId });

    return results;
  } finally {
    session?.close();
  }
};

const REPROVISION_JOB = 'servers.reprovision';

registerJobHandler(REPROVISION_JOB, async payload => {
  const serverId = payload.serverId as string;

  const server = await serverModel
    .findById(serverId)
    .select('+ssh.privateKey +ssh.password +ssh.passphrase +agent.token');

  if (!server) {
    return;
  }

  await provisionServer(server);
});

export const reprovisionRemoteServers = async () => {
  const servers = await serverModel.find({ type: 'ssh' });

  await Promise.all(
    servers.map(server =>
      enqueueJob(REPROVISION_JOB, { serverId: String(server._id) }, { maxAttempts: 1 }),
    ),
  );
};

const pushAgentBundle = async (server: Server & Document, bundle: AgentBundle) => {
  const serverId = String(server._id);
  const session = await openSshSession(server.ssh, server.ssh.fingerprint);

  try {
    const prefix = await detectPrivilegePrefix(session);

    await runChecked(
      session,
      `${prefix}mkdir -p ${AGENT_DIR}`,
      'Failed to create the agent directory',
    );
    await session.uploadFile(AGENT_BUNDLE, bundle.content, 0o755);
    await session.uploadFile(AGENT_UNIT, systemdUnit(), 0o644);

    await runChecked(
      session,
      `${prefix}systemctl daemon-reload && ${prefix}systemctl restart zydock-agent`,
      'Failed to restart the agent service',
    );
    await runChecked(
      session,
      healthCheck(server.agent.port, Boolean(server.agent.tlsIssuedAt)),
      'The agent did not answer its health check',
    );

    await serverModel.updateOne(
      { _id: serverId },
      { $set: { 'agent.installedAt': new Date(), 'agent.bundleHash': bundle.hash } },
    );

    logInfo('Agent bundle updated', { serverId, hash: bundle.hash.slice(0, 12) });
  } finally {
    session.close();
  }
};

export const syncAgentBundles = async () => {
  let bundle: AgentBundle;

  try {
    bundle = await readAgentBundle();
  } catch (error) {
    logWarn('Skipping the agent bundle sync', {
      error: error instanceof Error ? error.message : String(error),
    });

    return;
  }

  const servers = await serverModel
    .find({
      type: 'ssh',
      'agent.installedAt': { $exists: true, $ne: null },
      'agent.bundleHash': { $ne: bundle.hash },
    })
    .select('+ssh.privateKey +ssh.password +ssh.passphrase');

  if (!servers.length) {
    return;
  }

  logInfo('Syncing outdated agents', { servers: servers.length });

  for (const server of servers) {
    try {
      await pushAgentBundle(server, bundle);
    } catch (error) {
      logWarn('Failed to update the agent, it stays on the previous bundle', {
        serverId: String(server._id),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
};

const migrateAgentToMtls = async (server: Server & Document) => {
  const serverId = String(server._id);

  if (!server.agent.token) {
    throw new Error(`Server ${serverId} has no agent token: it was never fully provisioned`);
  }

  const token = decryptSecret(server.agent.token);
  const session = await openSshSession(server.ssh, server.ssh.fingerprint);

  try {
    const prefix = await detectPrivilegePrefix(session);

    await uploadAgentTls(session, prefix, serverId);
    await session.uploadFile(
      AGENT_ENV_FILE,
      agentEnvFile({ serverId, token, port: server.agent.port }),
      0o600,
    );
    await session.uploadFile(AGENT_UNIT, systemdUnit(), 0o644);

    const backendIp = await resolveBackendIp(session);

    await runChecked(
      session,
      secureNetwork(prefix, backendIp, server.agent.port),
      'Failed to restrict the agent port to the backend',
    );

    await runChecked(
      session,
      `${prefix}systemctl daemon-reload && ${prefix}systemctl restart zydock-agent`,
      'Failed to restart the agent service',
    );
    await runChecked(
      session,
      healthCheck(server.agent.port, true),
      'The agent did not answer its health check',
    );

    await serverModel.updateOne({ _id: serverId }, { $set: { 'agent.tlsIssuedAt': new Date() } });

    logInfo('Agent migrated to the protected channel', { serverId });
  } finally {
    session.close();
  }
};

export const migrateAgentsToMtls = async () => {
  const servers = await serverModel
    .find({
      type: 'ssh',
      'agent.installedAt': { $exists: true, $ne: null },
      'agent.tlsIssuedAt': { $exists: false },
    })
    .select('+ssh.privateKey +ssh.password +ssh.passphrase +agent.token');

  if (!servers.length) {
    return;
  }

  logInfo('Migrating agents to the protected channel', { servers: servers.length });

  for (const server of servers) {
    try {
      await migrateAgentToMtls(server);
    } catch (error) {
      logWarn('Failed to migrate the agent to the protected channel, it stays on plain HTTP', {
        serverId: String(server._id),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
};

export const refreshServerResources = async (server: Server & Document) => {
  const probe = await probeConnection(decryptSshCredentials(server.ssh), server.ssh.fingerprint);

  if (!probe.reachable) {
    await serverModel.updateOne(
      { _id: server._id },
      { $set: { status: 'offline', lastError: probe.error } },
    );

    return probe;
  }

  await serverModel.updateOne(
    { _id: server._id },
    {
      $set: {
        'resources.cpuCount': probe.cpuCount,
        'resources.memoryMb': probe.memoryMb,
        'resources.diskGb': probe.diskGb,
        'resources.osRelease': probe.osRelease,
        'resources.dockerVersion': probe.dockerVersion,
      },
    },
  );

  return probe;
};
