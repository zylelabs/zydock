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

export const ensureAgentCa = async () => {
  const existing = await agentCaModel.findOne().select('+caKeyPem +clientKeyPem');

  if (existing) {
    cached = {
      caCertPem: existing.caCertPem,
      clientCertPem: existing.clientCertPem,
      clientKeyPem: decryptSecret(existing.clientKeyPem),
    };

    return;
  }

  const provider = resolveTlsProvider();
  const authority = await provider.createCertificateAuthority(CA_COMMON_NAME);
  const client = await provider.issueCertificate(BACKEND_CLIENT_COMMON_NAME, authority);

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
