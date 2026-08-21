import { isIPv4 } from 'node:net';
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

const resolveHostAddresses = (hostname: string) =>
  Promise.race([
    lookup(hostname, { all: true }).then(addresses => addresses.map(({ address }) => address)),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('DNS lookup timed out')), DNS_TIMEOUT_MS),
    ),
  ]);

const isPrivateIPv4 = (address: string) => {
  const octets = address.split('.').map(Number);

  if (octets.length !== 4 || octets.some(octet => Number.isNaN(octet))) {
    return true;
  }

  const [a, b] = octets;

  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
};

const isPrivateIPv6 = (address: string) => {
  const normalized = address.toLowerCase();

  if (normalized === '::1' || normalized === '::') {
    return true;
  }

  if (normalized.startsWith('::ffff:')) {
    const mapped = normalized.slice('::ffff:'.length);

    return isIPv4(mapped) ? isPrivateIPv4(mapped) : true;
  }

  return (
    normalized.startsWith('fe80:') || normalized.startsWith('fc') || normalized.startsWith('fd')
  );
};

const isPrivateAddress = (address: string) =>
  isIPv4(address) ? isPrivateIPv4(address) : isPrivateIPv6(address);

export const assertPublicHost = async (url: string) => {
  const hostname = new URL(url).hostname;

  let addresses: string[];

  try {
    addresses = await resolveHostAddresses(hostname);
  } catch (error) {
    throw new Error(`Could not resolve host "${hostname}": ${errorMessage(error)}`);
  }

  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new Error(
      `Host "${hostname}" resolves to a private, loopback or link-local address, which is not allowed`,
    );
  }
};

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
