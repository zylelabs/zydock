import { resolveTlsProvider } from '../../providers/tls';
import { decryptSecret, encryptSecret } from '../../utils/crypto';
import agentCaModel from './agent-ca.model';

const CA_COMMON_NAME = 'Zydock Agent CA';
const BACKEND_CLIENT_COMMON_NAME = 'zydock-backend';

export type AgentTlsMaterial = {
  cert: string;
  key: string;
  ca: string;
  serverName: string;
};

let cached: { caCertPem: string; clientCertPem: string; clientKeyPem: string } | undefined;
let loading: Promise<void> | undefined;

const findStoredAgentCa = () => agentCaModel.findOne().select('+caKeyPem +clientKeyPem');

const cacheStored = (stored: AgentCa) => {
  cached = {
    caCertPem: stored.caCertPem,
    clientCertPem: stored.clientCertPem,
    clientKeyPem: decryptSecret(stored.clientKeyPem),
  };
};

const loadAgentCa = async () => {
  const existing = await findStoredAgentCa();

  if (existing) {
    cacheStored(existing);

    return;
  }

  const provider = resolveTlsProvider();
  const authority = await provider.createCertificateAuthority(CA_COMMON_NAME);
  const client = await provider.issueCertificate(BACKEND_CLIENT_COMMON_NAME, authority);

  try {
    await agentCaModel.create({
      caCertPem: authority.certPem,
      caKeyPem: encryptSecret(authority.keyPem),
      clientCertPem: client.certPem,
      clientKeyPem: encryptSecret(client.keyPem),
    });

    cached = {
      caCertPem: authority.certPem,
      clientCertPem: client.certPem,
      clientKeyPem: client.keyPem,
    };
  } catch (error) {
    const stored = await findStoredAgentCa();

    if (!stored) {
      throw error;
    }

    cacheStored(stored);
  }
};

export const ensureAgentCa = () => {
  loading ??= loadAgentCa().finally(() => {
    loading = undefined;
  });

  return loading;
};

const getCache = () => {
  if (!cached) {
    throw new Error('The agent CA has not been loaded yet: call ensureAgentCa() at boot');
  }

  return cached;
};

export const getAgentCaCertPem = () => getCache().caCertPem;

export const buildAgentTlsMaterial = (serverId: string): AgentTlsMaterial => {
  const { caCertPem, clientCertPem, clientKeyPem } = getCache();

  return { cert: clientCertPem, key: clientKeyPem, ca: caCertPem, serverName: serverId };
};

export const issueServerCertificate = async (serverId: string) => {
  const existing = await agentCaModel.findOne().select('+caKeyPem');

  if (!existing) {
    throw new Error('The agent CA has not been created yet');
  }

  const provider = resolveTlsProvider();

  return provider.issueCertificate(serverId, {
    certPem: existing.caCertPem,
    keyPem: decryptSecret(existing.caKeyPem),
  });
};
