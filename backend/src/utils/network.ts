import { lookup } from 'node:dns/promises';
import { errorMessage } from '.';

const DNS_TIMEOUT_MS = 3000;

const resolveHost = (hostname: string) =>
  Promise.race([
    lookup(hostname).then(({ address }) => address),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('DNS lookup timed out')), DNS_TIMEOUT_MS),
    ),
  ]);

export const describeConnectionFailure = async (url: string, error: unknown) => {
  const reason = errorMessage(error);

  let hostname: string;

  try {
    hostname = new URL(url).hostname;
  } catch {
    return reason;
  }

  if (!hostname) {
    return reason;
  }

  try {
    const address = await resolveHost(hostname);

    return `${reason} (${hostname} resolves to ${address}, so the name is fine and the connection itself failed: check the outbound access of this container — firewall, DOCKER-USER rules, proxy)`;
  } catch {
    return `${reason} (${hostname} could not be resolved from this container: check the DNS of the Docker daemon)`;
  }
};
