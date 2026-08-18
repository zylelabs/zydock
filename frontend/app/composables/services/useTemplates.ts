import type { Paginated } from '../useApi';
import { formatRelativeTime } from '../../utils';
import type { Application } from './useApplications';

export type TemplateInputType = 'text' | 'password' | 'number' | 'boolean' | 'select';
export type TemplateOrigin = 'official' | 'community';
export type TemplateDatabaseEngine = 'postgresql' | 'mysql' | 'mongodb' | 'redis';

export interface TemplateInput {
  key: string;
  label: string;
  type: TemplateInputType;
  options?: string[];
  default?: string | number | boolean;
  required: boolean;
  min?: number;
  max?: number;
  pattern?: string;
  help?: string;
  must_be_true?: boolean;
}

export interface TemplateSecret {
  key: string;
  generate: 'password' | 'hex32' | 'uuid';
}

export type TemplateExposeKind = 'http' | 'tcp' | 'udp';

export interface TemplateExpose {
  service: string;
  port: number;
  kind: TemplateExposeKind;
  host_port_key?: string;
  domain: boolean;
}

export interface TemplateDatabase {
  service: string;
  engine: TemplateDatabaseEngine;
}

export interface TemplateVersionEntry {
  value: string;
  label?: string;
}

export interface TemplateVersionsRegistry {
  include?: string;
  exclude?: string;
  limit: number;
}

export interface TemplateVersions {
  key: string;
  default?: string;
  available: TemplateVersionEntry[];
  registry?: TemplateVersionsRegistry;
}

export type TemplateVersionOrigin = 'catalog' | 'registry';

export interface TemplateVersionOption {
  value: string;
  label?: string;
  updatedAt?: string;
  origin: TemplateVersionOrigin;
}

export type TemplateVersionsSource = 'catalog' | 'registry' | 'mixed';

export interface TemplateVersionsListing {
  source: TemplateVersionsSource;
  versions: TemplateVersionOption[];
  fetchedAt?: string;
  degraded?: { reason: string };
}

export interface Template {
  id: string;
  version: number;
  name: string;
  tagline: string;
  category: string;
  tags: string[];
  icon?: string;
  website?: string;
  documentation?: string;
  license?: string;
  author: string;
  origin: TemplateOrigin;
  deprecated: boolean;
  expose: TemplateExpose;
  databases: TemplateDatabase[];
  inputs: TemplateInput[];
  secrets: TemplateSecret[];
  versions?: TemplateVersions;
  memoryLimitMb?: number;
}

export type TemplateFilter = {
  search?: string;
  category?: string;
  origin?: TemplateOrigin;
  page?: number;
  size?: number;
};

export interface DeployTemplateBody {
  organizationId: string;
  name: string;
  environmentId: string;
  serverId: string;
  inputs: Record<string, string>;
  version?: string;
  deployNow?: boolean;
  resources?: { cpus?: number; memoryMb?: number };
}

export const mergeVersionOptions = (
  listing: TemplateVersionsListing | null,
  curated: TemplateVersionEntry[],
  ensureValue?: string,
): TemplateVersionOption[] => {
  const base: TemplateVersionOption[] = listing
    ? listing.versions
    : curated.map(entry => ({ value: entry.value, label: entry.label, origin: 'catalog' }));

  if (!ensureValue || base.some(option => option.value === ensureValue)) {
    return base;
  }

  const curatedEntry = curated.find(entry => entry.value === ensureValue);

  return [{ value: ensureValue, label: curatedEntry?.label, origin: 'catalog' }, ...base];
};

const PLAIN_VERSION_PATTERN = /^v?\d+(\.\d+){0,2}$/;

export const preferredVersionOf = (options: TemplateVersionOption[]): string =>
  (options.find(option => PLAIN_VERSION_PATTERN.test(option.value)) ?? options[0])?.value ?? '';

export const templateVersionSelectOptions = (
  options: { value: string; label?: string; updatedAt?: string }[],
) =>
  options.map(option => ({
    value: option.value,
    label: option.label ?? option.value,
    hint: option.updatedAt ? formatRelativeTime(option.updatedAt) : undefined,
  }));

export const useTemplates = () => {
  const api = useApi();

  const base = () => '/templates';

  const list = (filter: TemplateFilter = {}) =>
    api.get<Paginated<Template>>(base(), { query: { size: 100, ...filter } });
  const get = (templateId: string) => api.get<{ template: Template }>(`${base()}/${templateId}`);
  const icon = (templateId: string) => api.get<Blob>(`${base()}/${templateId}/icon`);
  const deploy = (templateId: string, body: DeployTemplateBody) =>
    api.post<{ application: Application; deployment?: { id: string } }>(
      `${base()}/${templateId}/deploy`,
      { body },
    );
  const listVersions = (templateId: string, search?: string) =>
    api.get<TemplateVersionsListing>(`${base()}/${templateId}/versions`, { query: { search } });

  return { list, get, icon, deploy, listVersions };
};
