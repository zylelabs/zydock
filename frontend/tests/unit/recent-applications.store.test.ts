import { beforeEach, describe, expect, test } from 'bun:test';
import { createPinia, setActivePinia } from 'pinia';
import {
  useRecentApplicationsStore,
  type IRecentApplication,
} from '../../app/stores/recent-applications.store';

const application = (overrides: Partial<IRecentApplication> = {}): IRecentApplication => ({
  id: 'app-1',
  name: 'uptime-kuma',
  status: 'running',
  ...overrides,
});

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('push', () => {
  test('moves the pushed application to the top of its organization', () => {
    const store = useRecentApplicationsStore();

    store.push('org-1', application({ id: 'app-1' }));
    store.push('org-1', application({ id: 'app-2' }));
    store.push('org-1', application({ id: 'app-1' }));

    expect(store.forOrganization('org-1').map(item => item.id)).toEqual(['app-1', 'app-2']);
  });

  test('deduplicates by id instead of adding a second entry', () => {
    const store = useRecentApplicationsStore();

    store.push('org-1', application({ id: 'app-1', name: 'first-name' }));
    store.push('org-1', application({ id: 'app-1', name: 'second-name' }));

    expect(store.forOrganization('org-1')).toHaveLength(1);
    expect(store.forOrganization('org-1')[0]?.name).toBe('second-name');
  });

  test('caps the list at 5 items per organization', () => {
    const store = useRecentApplicationsStore();

    for (let index = 0; index < 7; index += 1) {
      store.push('org-1', application({ id: `app-${index}` }));
    }

    const list = store.forOrganization('org-1');

    expect(list).toHaveLength(5);
    expect(list.map(item => item.id)).toEqual(['app-6', 'app-5', 'app-4', 'app-3', 'app-2']);
  });

  test('keeps organizations isolated from each other', () => {
    const store = useRecentApplicationsStore();

    store.push('org-1', application({ id: 'app-1' }));
    store.push('org-2', application({ id: 'app-2' }));

    expect(store.forOrganization('org-1').map(item => item.id)).toEqual(['app-1']);
    expect(store.forOrganization('org-2').map(item => item.id)).toEqual(['app-2']);
  });
});

describe('sync', () => {
  test('updates name and status without reordering the list', () => {
    const store = useRecentApplicationsStore();

    store.push('org-1', application({ id: 'app-1' }));
    store.push('org-1', application({ id: 'app-2' }));

    store.sync('org-1', application({ id: 'app-2', name: 'renamed', status: 'stopped' }));

    const list = store.forOrganization('org-1');

    expect(list.map(item => item.id)).toEqual(['app-2', 'app-1']);
    expect(list[0]).toMatchObject({ id: 'app-2', name: 'renamed', status: 'stopped' });
  });

  test('does nothing when the application is not in the list', () => {
    const store = useRecentApplicationsStore();

    store.push('org-1', application({ id: 'app-1' }));
    store.sync('org-1', application({ id: 'app-2', name: 'renamed' }));

    expect(store.forOrganization('org-1')).toEqual([application({ id: 'app-1' })]);
  });

  test('does nothing when the organization has no list yet', () => {
    const store = useRecentApplicationsStore();

    store.sync('org-1', application({ id: 'app-1' }));

    expect(store.forOrganization('org-1')).toEqual([]);
  });
});

describe('remove', () => {
  test('removes only the targeted application', () => {
    const store = useRecentApplicationsStore();

    store.push('org-1', application({ id: 'app-1' }));
    store.push('org-1', application({ id: 'app-2' }));

    store.remove('org-1', 'app-1');

    expect(store.forOrganization('org-1').map(item => item.id)).toEqual(['app-2']);
  });

  test('does nothing when the organization has no list yet', () => {
    const store = useRecentApplicationsStore();

    store.remove('org-1', 'app-1');

    expect(store.forOrganization('org-1')).toEqual([]);
  });
});

describe('clear', () => {
  test('empties every organization', () => {
    const store = useRecentApplicationsStore();

    store.push('org-1', application({ id: 'app-1' }));
    store.push('org-2', application({ id: 'app-2' }));

    store.clear();

    expect(store.forOrganization('org-1')).toEqual([]);
    expect(store.forOrganization('org-2')).toEqual([]);
  });
});
