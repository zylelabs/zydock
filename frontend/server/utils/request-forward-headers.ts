import type { H3Event } from 'h3';

export const getForwardedRequestHeaders = (event: H3Event): Record<string, string> => {
  const requestIp = getRequestIP(event, { xForwardedFor: true }) || '';

  const forwardedFor = event.headers.get('x-forwarded-for') || requestIp;
  const realIp = event.headers.get('x-real-ip') || requestIp;
  const forwarded = event.headers.get('forwarded') || (requestIp ? `for=${requestIp}` : '');
  const cfConnectingIp = event.headers.get('cf-connecting-ip') || '';
  const trueClientIp = event.headers.get('true-client-ip') || '';

  const entries = [
    ['x-forwarded-for', forwardedFor],
    ['x-real-ip', realIp],
    ['forwarded', forwarded],
    ['cf-connecting-ip', cfConnectingIp],
    ['true-client-ip', trueClientIp],
  ] as const;

  return entries.reduce<Record<string, string>>((headers, [key, value]) => {
    if (!value) {
      return headers;
    }

    headers[key] = value;

    return headers;
  }, {});
};
