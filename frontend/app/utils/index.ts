import { twMerge, type ClassNameValue } from 'tailwind-merge';
import type { H3Event } from 'h3';
import type { IFetchNativeResponseError, IFetchResponseError } from '~~/server/types';

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export function mergeClasses(...classString: ClassNameValue[]) {
  return twMerge(classString);
}

export const formatBytes = (bytes?: number) => {
  if (!bytes) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;

  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
};

export const formatDuration = (milliseconds?: number) => {
  if (!milliseconds) {
    return '—';
  }

  const seconds = Math.round(milliseconds / 1000);

  if (seconds < 60) {
    return `${seconds}s`;
  }

  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
};

export const normalizeFetchErrorServer = (
  event: H3Event,
  err: unknown,
  returnUndefined?: boolean,
) => {
  if (typeof err === 'object' && err !== null && 'statusCode' in err) {
    const error = err as IFetchNativeResponseError;

    setResponseStatus(event, error.statusCode);

    if (!error.data || typeof error.data === 'string') {
      const filteredError: IFetchResponseError = {
        statusCode: error.statusCode,
        message: error.statusMessage,
      };

      return filteredError;
    }

    return error.data;
  }

  if (err instanceof Error) {
    setResponseStatus(event, 500);

    const apiUrl = process.env.URL_API;
    const message = apiUrl ? err.message?.replaceAll(apiUrl, '**') : err.message;

    return {
      statusCode: 500,
      message: message || 'Internal error',
    };
  }

  console.error('Internal error [...path.ts]', err);

  return returnUndefined
    ? undefined
    : {
        statusCode: 500,
        message: 'Internal error',
      };
};

export const removeUndefinedKeys = <T>(obj: T): T => {
  if (Array.isArray(obj)) {
    return obj.map(item => removeUndefinedKeys(item)).filter(item => item !== undefined) as T;
  }

  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};

    Object.entries(obj).forEach(([key, value]) => {
      const cleanedValue = removeUndefinedKeys(value);

      const isEmptyObject =
        cleanedValue &&
        typeof cleanedValue === 'object' &&
        !Array.isArray(cleanedValue) &&
        Object.keys(cleanedValue).length === 0;

      if (cleanedValue !== undefined && !isEmptyObject) {
        result[key] = cleanedValue;
      }
    });

    return result as T;
  }

  return obj;
};

export const hasValue = (value: any) => {
  if (value === undefined || value === null) {
    return false;
  }

  return true;
};

export const orDash = (value: any) =>
  value === null || value === undefined || value === '' ? '-' : value;

const hashName = (name: string) => {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (Math.imul(hash, 31) + name.charCodeAt(i)) | 0;
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  hash ^= hash >>> 16;
  return hash >>> 0;
};

export const getHueFromName = (name: string) => {
  if (!name?.trim()) {
    return {
      '--generated-hue': '0deg',
      '--generated-sat': '0%',
    };
  }

  const hash = hashName(name);
  const hue = hash % 360;
  const saturation = 55 + ((hash >>> 9) % 20);

  return {
    '--generated-hue': `${hue}deg`,
    '--generated-sat': `${saturation}%`,
  };
};

export const getColorFromName = (name: string) => {
  if (!name?.trim()) return `hsl(0 0% 55%)`;

  const hash = hashName(name);
  const hue = hash % 360;
  const saturation = 55 + ((hash >>> 9) % 20);
  const lightness = 45 + ((hash >>> 17) % 18);

  return `hsl(${hue} ${saturation}% ${lightness}%)`;
};
