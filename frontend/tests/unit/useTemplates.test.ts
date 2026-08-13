import { describe, expect, test } from 'bun:test';
import {
  mergeVersionOptions,
  templateVersionSelectOptions,
  type TemplateVersionEntry,
  type TemplateVersionsListing,
} from '../../app/composables/services/useTemplates';

const curated: TemplateVersionEntry[] = [
  { value: '1', label: '1.x' },
  { value: '2', label: '2.x (stable)' },
];

const listing = (overrides: Partial<TemplateVersionsListing> = {}): TemplateVersionsListing => ({
  source: 'mixed',
  versions: [
    { value: '1', label: '1.x', origin: 'catalog' },
    { value: '2', label: '2.x (stable)', origin: 'catalog' },
    { value: '2.5.0', origin: 'registry', updatedAt: '2024-02-15T00:00:00.000Z' },
  ],
  ...overrides,
});

describe('mergeVersionOptions', () => {
  test('with no listing yet, falls back to the curated list', () => {
    const options = mergeVersionOptions(null, curated);

    expect(options).toEqual([
      { value: '1', label: '1.x', origin: 'catalog' },
      { value: '2', label: '2.x (stable)', origin: 'catalog' },
    ]);
  });

  test('with a listing, unions catalog and registry versions as returned by the backend', () => {
    const options = mergeVersionOptions(listing(), curated);

    expect(options.map(option => option.value)).toEqual(['1', '2', '2.5.0']);
    expect(options.find(option => option.value === '2.5.0')?.origin).toBe('registry');
  });

  test('the current running version is unioned in when the registry no longer lists it', () => {
    const options = mergeVersionOptions(listing(), curated, '9.9.9');

    expect(options[0]).toEqual({ value: '9.9.9', label: undefined, origin: 'catalog' });
    expect(options.map(option => option.value)).toEqual(['9.9.9', '1', '2', '2.5.0']);
  });

  test('the current running version keeps its curated label when present', () => {
    const options = mergeVersionOptions(listing({ versions: [] }), curated, '1');

    expect(options[0]).toEqual({ value: '1', label: '1.x', origin: 'catalog' });
  });

  test('a version already present is not duplicated', () => {
    const options = mergeVersionOptions(listing(), curated, '2');

    expect(options.filter(option => option.value === '2')).toHaveLength(1);
  });

  test('a degraded listing still exposes the curated versions it fell back to', () => {
    const degraded = listing({
      source: 'catalog',
      versions: [{ value: '1', label: '1.x', origin: 'catalog' }],
      degraded: { reason: 'registry unreachable' },
    });

    const options = mergeVersionOptions(degraded, curated, '9.9.9');

    expect(options.map(option => option.value)).toEqual(['9.9.9', '1']);
  });
});

describe('templateVersionSelectOptions', () => {
  test('maps value/label and falls back to value when there is no label', () => {
    const options = templateVersionSelectOptions([
      { value: '1', origin: 'catalog' },
      { value: '2', label: '2.x (stable)', origin: 'catalog' },
    ]);

    expect(options).toEqual([
      { value: '1', label: '1', hint: undefined },
      { value: '2', label: '2.x (stable)', hint: undefined },
    ]);
  });

  test('shows a relative-time hint for options with updatedAt', () => {
    const options = templateVersionSelectOptions([
      { value: '2.5.0', origin: 'registry', updatedAt: new Date().toISOString() },
    ]);

    expect(options[0]?.hint).toBeString();
  });
});
