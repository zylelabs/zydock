export const resolveWebSocketUrl = (rawWsUrl: string) => {
  const configuredHost = rawWsUrl ? new URL(rawWsUrl).host : '';

  if (configuredHost && configuredHost === window.location.host) {
    return rawWsUrl;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

  return `${protocol}//${window.location.host}/api/ws`;
};
