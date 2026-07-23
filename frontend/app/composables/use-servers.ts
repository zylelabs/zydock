import type { Paginated } from '~/composables/use-api';

export type ServerStatus =
  'pending' | 'validating' | 'provisioning' | 'online' | 'offline' | 'failed';

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
  organizationId: string;
  name: string;
  status: ServerStatus;
  online: boolean;
  ssh: { host: string; port: number; username: string; fingerprint?: string };
  agent: { port: number; version?: string; installedAt?: string; lastHeartbeatAt?: string };
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

/** What `POST /servers/validate` answers: whether the host is reachable and what was probed on it. */
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

export const useServers = () => {
  const api = useApi();
  const session = useSessionStore();

  const base = () => `/organizations/${session.organizationId}/servers`;

  const list = () => api.get<Paginated<Server>>(base(), { query: { size: 100 } });

  const validate = (ssh: SshCredentials) =>
    api.post<ConnectionProbe>(`${base()}/validate`, { body: { ssh } });

  const create = (body: CreateServerBody) => api.post<{ server: Server }>(base(), { body });

  const provision = (serverId: string) =>
    api.post<{ steps: unknown }>(`${base()}/${serverId}/provision`);

  const remove = (serverId: string) => api.del<{ message: string }>(`${base()}/${serverId}`);

  return { list, validate, create, provision, remove };
};
