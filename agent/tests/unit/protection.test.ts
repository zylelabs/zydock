import { describe, expect, test } from 'bun:test';
import {
  COMPOSE_PROJECT_LABEL,
  COMPOSE_SERVICE_LABEL,
  isManagedVolume,
  isProtectedContainer,
  isProtectedResource,
  MANAGED_VOLUME_LABEL,
  PROTECTED_LABEL,
} from '../../src/modules/containers/protection.service';

describe('isProtectedContainer', () => {
  test('a container with the Compose stack labels is protected', () => {
    const container = {
      id: 'aaaaaaaaaaaa',
      labels: { [COMPOSE_PROJECT_LABEL]: 'zydock', [COMPOSE_SERVICE_LABEL]: 'mongo' },
    };

    expect(isProtectedContainer(container)).toBe(true);
  });

  test('an application container (zydock.application) stays removable', () => {
    const container = {
      id: 'bbbbbbbbbbbb',
      labels: { 'zydock.application': 'my-app-slug' },
    };

    expect(isProtectedContainer(container)).toBe(false);
  });
});

describe('isProtectedResource', () => {
  test('the mongo-data volume (Compose stack labels) refuses removal', () => {
    const labels = { [COMPOSE_PROJECT_LABEL]: 'zydock', [COMPOSE_SERVICE_LABEL]: 'mongo' };

    expect(isProtectedResource(labels)).toBe(true);
  });

  test('the zydock network (Compose project label, no service) refuses removal', () => {
    const labels = { [COMPOSE_PROJECT_LABEL]: 'zydock' };

    expect(isProtectedResource(labels)).toBe(true);
  });

  test('a resource with the explicit zydock.protected label refuses removal', () => {
    expect(isProtectedResource({ [PROTECTED_LABEL]: 'true' })).toBe(true);
  });

  test('a "zydock-<slug>" application container name without a system label is not protected', () => {
    const labels = { 'zydock.application': 'zydock-my-app-slug' };

    expect(isProtectedResource(labels)).toBe(false);
    expect(isProtectedResource({})).toBe(false);
  });
});

describe('isManagedVolume', () => {
  test('a volume created through the Zydock API carries the managed label', () => {
    expect(isManagedVolume({ [MANAGED_VOLUME_LABEL]: 'true' })).toBe(true);
  });

  test('a volume created by a Compose deploy carries the project label', () => {
    expect(isManagedVolume({ [COMPOSE_PROJECT_LABEL]: 'my-app' })).toBe(true);
  });

  test('a protected system volume is also managed', () => {
    expect(isManagedVolume({ [PROTECTED_LABEL]: 'true' })).toBe(true);
  });

  test('a volume created outside Zydock has none of these labels', () => {
    expect(isManagedVolume({})).toBe(false);
    expect(isManagedVolume({ some: 'other-label' })).toBe(false);
  });
});
