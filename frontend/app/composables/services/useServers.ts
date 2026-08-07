import type { Paginated } from '../useApi';
import type { Status } from '~/components/elements/StatusDot.vue';

export type ServerStatus =
  'pending' | 'validating' | 'provisioning' | 'online' | 'offline' | 'failed';

export const serverStatusDot = (status: ServerStatus): Status => {
  if (status === 'online') {
    return 'live';
  }

  if (status === 'offline' || status === 'failed') {
    return 'failed';
  }

  return 'attn';
};

export type ServerType = 'ssh' | 'local';

export interface SshCredentials {
  host: string;
  port: number;
  username: string;
  privateKey?: string;
  password?: string;
  passphrase?: string;
}

export interface Server {
  id: string;
  organizationId: string | null;
  name: string;
  type: ServerType;
  status: ServerStatus;
  online: boolean;
  managed: boolean;
  ssh: { host?: string; port?: number; username?: string; fingerprint?: string };
  agent: {
    host?: string;
    port: number;
    version?: string;
    installedAt?: string;
    lastHeartbeatAt?: string;
  };
  resources: {
    cpuCount?: number;
    memoryMb?: number;
    diskGb?: number;
    osRelease?: string;
    dockerVersion?: string;
  };
  lastError?: string;
  createdAt: string;
}

export interface ConnectionProbe {
  reachable: boolean;
  error?: string;
  fingerprint?: string;
  osRelease?: string;
  cpuCount?: number;
  memoryMb?: number;
  diskGb?: number;
  dockerVersion?: string;
}

export interface CreateServerBody {
  name: string;
  ssh: SshCredentials;
  agentPort?: number;
}

export interface UpdateServerBody {
  name?: string;
  ssh?: SshCredentials;
}

export type ProvisioningStepName =
  | 'connect'
  | 'install-docker'
  | 'install-runtime'
  | 'install-proxy'
  | 'upload-agent'
  | 'configure-agent'
  | 'start-agent'
  | 'verify-agent';

export interface ProvisioningResult {
  step: ProvisioningStepName;
  ok: boolean;
  detail?: string;
}

export const useServers = () => {
  const api = useApi();
  const session = useSessionStore();

  const base = () => `/organizations/${session.organizationId}/servers`;

  const list = (options: { size?: number } = {}) =>
    api.get<Paginated<Server>>(base(), { query: { size: options.size ?? 100 } });
  const get = (serverId: string) => api.get<{ server: Server }>(`${base()}/${serverId}`);

  const validate = (ssh: SshCredentials) =>
    api.post<ConnectionProbe>(`${base()}/validate`, { body: { ssh } });

  const create = (body: CreateServerBody) => api.post<{ server: Server }>(base(), { body });

  const update = (serverId: string, body: UpdateServerBody) =>
    api.patch<{ server: Server }>(`${base()}/${serverId}`, { body });

  const provision = (serverId: string) =>
    api.post<{ steps: ProvisioningResult[] }>(`${base()}/${serverId}/provision`);

  const refresh = (serverId: string) => api.post<ConnectionProbe>(`${base()}/${serverId}/refresh`);

  const remove = (serverId: string) => api.del<{ message: string }>(`${base()}/${serverId}`);

  const provisioningTopic = (serverId: string) => `server:${serverId}:provisioning`;

  return { list, get, validate, create, update, provision, refresh, remove, provisioningTopic };
};
