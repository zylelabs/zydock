import { isEmpty, isPlainObject } from 'lodash-es';
import { normalizeFetchErrorServer, removeUndefinedKeys } from '~/utils';
import { createConsola } from 'consola';

const logger = createConsola({
  formatOptions: {
    colors: true,
    compact: true,
    date: true,
  },
});

const REFRESH_TOKEN_ROUTES = new Set(['auth/signin', 'auth/signup', 'auth/refresh']);

export default defineEventHandler(async event => {
  const path = event.context.params?.path || [];
  const pathString = Array.isArray(path) ? path.join('/') : path;

  const method = event.method;
  const { ...query } = getQuery(event);

  const baseUrl = process.env.URL_API;
  const targetUrl = `${baseUrl}/api/${pathString}`.replaceAll('//', '/').replaceAll(':/', '://');
  let body = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
    ? await readBody(event)
    : undefined;
  const headers = event.headers;
  const queryToSend = query.ignoreSerialize ? query : flattenObject(query);

  if (pathString === 'auth/refresh') {
    const refreshToken = readRefreshTokenCookie(event);

    if (!refreshToken) {
      throw createError({ statusCode: 401, statusMessage: 'Invalid or expired refresh token' });
    }

    body = { refreshToken };
  }

  try {
    const response = await $fetch(targetUrl, {
      method,
      body,
      headers: {
        authorization: headers.get('Authorization') || '',
        'x-forward-for': headers.get('x-forward-for') || '',
        'Content-Type': headers.get('Content-Type') || 'application/json',
      },
      query: queryToSend,
    });

    const contentType = headers.get('Content-Type') || '';

    const info = removeUndefinedKeys({
      user: headers.get('user') || undefined,
      body: processBodyForLog(body, headers),
      query: removeUndefinedKeys(queryToSend),
      ...(contentType.includes('multipart/form-data') ? { contentType } : {}),
    });

    const infoStr = !isEmpty(info) ? safeStringify(info) : '';

    logger.success(`[${method}] - ${targetUrl}`, infoStr ? '-' : '', infoStr);

    if (response instanceof Blob) {
      setResponseHeader(event, 'content-type', response.type || 'application/octet-stream');

      return Buffer.from(await response.arrayBuffer());
    }

    if (pathString === 'auth/logout') {
      clearRefreshTokenCookie(event);
    }

    if (
      REFRESH_TOKEN_ROUTES.has(pathString) &&
      isPlainObject(response) &&
      'refreshToken' in (response as Record<string, unknown>)
    ) {
      const { refreshToken, ...rest } = response as Record<string, unknown> & {
        refreshToken: string;
      };

      setRefreshTokenCookie(event, refreshToken);

      return rest;
    }

    return response;
  } catch (err) {
    const contentType = headers.get('Content-Type') || '';

    const info = removeUndefinedKeys({
      user: headers.get('user') || undefined,
      body: processBodyForLog(body, headers),
      query: removeUndefinedKeys(queryToSend),
      response: normalizeFetchErrorServer(event, err) || undefined,
      ...(contentType.includes('multipart/form-data') ? { contentType } : {}),
    });

    const infoStr = !isEmpty(info) ? safeStringify(info) : '';

    logger.error(
      `[${method}] - ${targetUrl.replaceAll('//', '/').replaceAll(':/', '://')}`,
      infoStr ? '-' : '',
      infoStr,
    );

    return normalizeFetchErrorServer(event, err);
  }
});

function processBodyForLog(body: any, headers: Headers): any {
  if (!body) return body;

  const contentType = headers.get('Content-Type') || '';

  if (typeof body === 'string' && contentType.includes('multipart/form-data')) {
    return parseMultipartForLog(body);
  }

  if (isPlainObject(body)) {
    return sanitizeObjectBody(body);
  }

  return body;
}

function sanitizeObjectBody(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;

  if (isBinary(obj)) return '(binary)';

  if (Array.isArray(obj)) {
    return obj.map(item => (isBinary(item) ? '(binary)' : sanitizeObjectBody(item)));
  }

  const clean: Record<string, any> = {};
  for (const key in obj) {
    const value = obj[key];
    clean[key] = isBinary(value) ? '(binary)' : sanitizeObjectBody(value);
  }
  return clean;
}

function isBinary(value: any): boolean {
  if (!value) return false;
  return (
    value instanceof ArrayBuffer ||
    value instanceof Uint8Array ||
    (typeof Buffer !== 'undefined' && value instanceof Buffer) ||
    (typeof File !== 'undefined' && value instanceof File) ||
    (typeof Blob !== 'undefined' && value instanceof Blob)
  );
}

function parseMultipartForLog(body: string): Record<string, string> {
  const result: Record<string, string> = {};

  const boundaryMatch = body.match(/^-+WebKitFormBoundary[^\r\n]+/m);
  const boundary = boundaryMatch ? boundaryMatch[0] : null;
  if (!boundary) return { raw: '(binary multipart/form-data)' };

  const parts = body.split(boundary).filter(p => p.trim() && p.trim() !== '--');

  for (const part of parts) {
    const nameMatch = part.match(/name="([^"]+)"/);
    if (!nameMatch || !nameMatch[1]) continue;

    const fieldName: string = nameMatch[1];
    const isFile = /filename="[^"]*"/.test(part);

    if (isFile) {
      result[fieldName] = '(binary)';
    } else {
      const valueMatch = part.match(/\r\n\r\n([\s\S]*?)\r\n$/);
      result[fieldName] = valueMatch?.[1] ?? '';
    }
  }

  return result;
}

function isJsonString(str: string): boolean {
  try {
    const parsed = JSON.parse(str);
    return isPlainObject(parsed);
  } catch {
    return false;
  }
}

export function flattenObject(
  obj: Record<string, unknown>,
  parentKey = '',
  result: Record<string, string> = {},
): Record<string, string> {
  for (const key in obj) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;

    let value = obj[key];

    if (typeof value === 'string' && isJsonString(value)) {
      value = JSON.parse(value);
    }

    const newKey = parentKey ? `${parentKey}[${key}]` : key;

    if (isPlainObject(value)) {
      flattenObject(value as Record<string, unknown>, newKey, result);
    } else if (typeof value !== 'undefined') {
      result[newKey] = String(value);
    }
  }
  return result;
}

function safeStringify(obj: any): string {
  const seen = new WeakSet<object>();
  const replacer = (_key: string, value: any) => {
    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: process.env.NODE_ENV === 'production' ? undefined : value.stack,
      };
    }
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
      const ctor = value.constructor?.name;
      if (['IncomingMessage', 'ServerResponse', 'Request', 'Response', 'Headers'].includes(ctor)) {
        return `[${ctor}]`;
      }
    }
    if (typeof value === 'function') return undefined;
    return value;
  };
  try {
    return JSON.stringify(obj, replacer);
  } catch {
    return '[Unserializable]';
  }
}
