import { file } from 'bun';
import type { Document } from 'mongoose';
import { createHash } from 'node:crypto';
import config from '../../config';
import type { SshSession } from '../../providers/ssh';
import { encryptSecret } from '../../utils/crypto';
import { logError, logInfo, logWarn } from '../../utils/logger';
import { publish } from '../websocket/websocket.service';
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

export type ProvisioningStep =
  | 'connect'
  | 'install-docker'
  | 'install-runtime'
  | 'install-proxy'
  | 'upload-agent'
  | 'configure-agent'
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
MODE="prod"
LOG_LEVEL="info"
SERVER_ID="${params.serverId}"
AGENT_TOKEN="${params.token}"
BACKEND_URL="${config.backendUrl}"
WORKSPACE_PATH="${config.deploy.workspacePath}"
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

const healthCheck = (port: number) =>
  `curl -fsS -m 10 --retry 10 --retry-delay 2 --retry-connrefused http://127.0.0.1:${port}/api/health`;

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

    await session.uploadFile(
      AGENT_ENV_FILE,
      agentEnvFile({ serverId, token, port: server.agent.port }),
      0o600,
    );
    await session.uploadFile(AGENT_UNIT, systemdUnit(), 0o644);
    record({ step: 'configure-agent', ok: true });

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
      healthCheck(server.agent.port),
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
      healthCheck(server.agent.port),
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
