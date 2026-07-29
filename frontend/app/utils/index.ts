import { twMerge, type ClassNameValue } from 'tailwind-merge';
import type { H3Event } from 'h3';
import type { IApiError, IFetchNativeError } from '~~/server/types';

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const mergeClasses = (...classes: ClassNameValue[]) => twMerge(classes);

const DAY_MS = 86_400_000;

const windowStart = (days: number) => {
  const today = new Date();

  today.setHours(0, 0, 0, 0);

  return today.getTime() - (days - 1) * DAY_MS;
};

export const dailyCounts = (dates: string[], days: number) => {
  const from = windowStart(days);
  const buckets = dates.map(date => Math.floor((new Date(date).getTime() - from) / DAY_MS));

  return Array.from({ length: days }, (_, day) => buckets.filter(bucket => bucket === day).length);
};

export const dailyCumulative = (dates: string[], days: number) => {
  const from = windowStart(days);
  const before = dates.filter(date => new Date(date).getTime() < from).length;

  return dailyCounts(dates, days).reduce<number[]>(
    (series, count) => [...series, (series.at(-1) ?? before) + count],
    [],
  );
};

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

const messageOf = (error: IFetchNativeError) => {
  if (error.data && typeof error.data === 'object' && 'error' in error.data) {
    return String((error.data as { error: unknown }).error);
  }

  return error.statusMessage || 'Request failed';
};

export const normalizeFetchError = (event: H3Event, error: unknown): IApiError => {
  if (typeof error === 'object' && error !== null && 'statusCode' in error) {
    const failure = error as IFetchNativeError;

    setResponseStatus(event, failure.statusCode);

    return { statusCode: failure.statusCode, error: messageOf(failure) };
  }

  setResponseStatus(event, 502);

  return { statusCode: 502, error: 'The API could not be reached' };
};
