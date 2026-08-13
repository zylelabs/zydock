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
}

export interface TemplateSecret {
  key: string;
  generate: 'password' | 'hex32' | 'uuid';
}

export interface TemplateExpose {
  service: string;
  port: number;
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
  default: string;
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
}

export type TemplateFilter = {
  search?: string;
  category?: string;
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
  const deploy = (templateId: string, body: DeployTemplateBody) =>
    api.post<{ application: Application; deployment?: { id: string } }>(
      `${base()}/${templateId}/deploy`,
      { body },
    );
  const listVersions = (templateId: string, search?: string) =>
    api.get<TemplateVersionsListing>(`${base()}/${templateId}/versions`, { query: { search } });

  return { list, get, deploy, listVersions };
};
