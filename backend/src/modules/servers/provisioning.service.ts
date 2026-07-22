import { file } from 'bun';
import type { Document } from 'mongoose';
import config from '../../config';
import type { SshSession } from '../../providers/ssh';
import { encryptSecret } from '../../utils/crypto';
import { logError, logInfo } from '../../utils/logger';
import { generateToken } from '../auth/session.service';
import { publish } from '../websocket/websocket.service';
import serverModel from './server.model';
import { decryptSshCredentials, openSshSession, probeConnection } from './server.service';

const AGENT_DIR = '/opt/zydock';
const AGENT_ENV_DIR = '/etc/zydock';
const AGENT_BUNDLE = `${AGENT_DIR}/agent.js`;
const AGENT_ENV_FILE = `${AGENT_ENV_DIR}/agent.env`;
const AGENT_UNIT = '/etc/systemd/system/zydock-agent.service';
const AGENT_TOKEN_BYTES = 32;

export type ProvisioningStep =
  | 'connect'
  | 'install-docker'
  | 'install-runtime'
  | 'upload-agent'
  | 'configure-agent'
  | 'start-agent'
  | 'verify-agent';

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

const installRuntime = (prefix: string) => `
set -e
if ! command -v bun >/dev/null 2>&1 && [ ! -x /usr/local/bin/bun ]; then
  curl -fsSL https://bun.sh/install | bash
  ${prefix}install -m 0755 "$HOME/.bun/bin/bun" /usr/local/bin/bun
fi
/usr/local/bin/bun --version
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
`;

const readAgentBundle = async () => {
  const bundle = file(config.node.bundlePath);

  if (!(await bundle.exists())) {
    throw new Error(
      `Agent bundle not found at "${config.node.bundlePath}". Run "bun run build" inside node/.`,
    );
  }

  return bundle.text();
};

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
    record({ step: 'install-runtime', ok: true, detail: runtimeVersion });

    currentStep = 'upload-agent';

    const bundle = await readAgentBundle();

    await runChecked(
      session,
      `${prefix}mkdir -p ${AGENT_DIR} ${AGENT_ENV_DIR} && ${prefix}chmod 700 ${AGENT_ENV_DIR}`,
      'Failed to create the agent directories',
    );
    await session.uploadFile(AGENT_BUNDLE, bundle, 0o755);
    record({ step: 'upload-agent', ok: true });

    currentStep = 'configure-agent';

    const token = generateToken(AGENT_TOKEN_BYTES);

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
      `curl -fsS -m 10 http://127.0.0.1:${server.agent.port}/api/health`,
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
