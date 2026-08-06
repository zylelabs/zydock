import { describe, expect, test } from 'bun:test';
import {
  fromCaddyRoute,
  toCaddyRoute,
  type RouteSpec,
} from '../../src/modules/proxy/proxy.service';

describe('toCaddyRoute', () => {
  test('a route with a domain matches by host and stays terminal', () => {
    const spec: RouteSpec = {
      id: 'app-1',
      domain: 'app.example.com',
      upstreams: [{ host: 'app-1', port: 3000 }],
    };

    const route = toCaddyRoute(spec);

    expect(route['@id']).toBe('zydock-route-app-1');
    expect(route.match).toEqual([{ host: ['app.example.com'] }]);
    expect(route.terminal).toBe(true);
  });

  test('a route with a domain and pathPrefix matches by host and path', () => {
    const spec: RouteSpec = {
      id: 'app-1',
      domain: 'app.example.com',
      pathPrefix: '/api',
      upstreams: [{ host: 'app-1', port: 3000 }],
    };

    const route = toCaddyRoute(spec);

    expect(route.match).toEqual([{ host: ['app.example.com'], path: ['/api*'] }]);
  });

  test('the default route has no host matcher', () => {
    const spec: RouteSpec = {
      id: 'system-dashboard',
      isDefault: true,
      upstreams: [{ host: 'frontend', port: 3000 }],
    };

    const route = toCaddyRoute(spec);

    expect(route.match).toBeUndefined();
    expect(route.terminal).toBe(true);
  });

  test('the default route with a pathPrefix matches by path only', () => {
    const spec: RouteSpec = {
      id: 'system-dashboard-websocket',
      isDefault: true,
      pathPrefix: '/api/ws',
      upstreams: [{ host: 'backend', port: 8000 }],
    };

    const route = toCaddyRoute(spec);

    expect(route.match).toEqual([{ path: ['/api/ws*'] }]);
  });
});

describe('fromCaddyRoute', () => {
  const managedDomains = ['app.example.com'];

  test('reflects a domain route with its tls state', () => {
    const spec: RouteSpec = {
      id: 'app-1',
      domain: 'app.example.com',
      upstreams: [{ host: 'app-1', port: 3000 }],
    };

    const route = fromCaddyRoute(toCaddyRoute(spec), managedDomains);

    expect(route).toMatchObject({ id: 'app-1', domain: 'app.example.com', tls: true });
  });

  test('reflects the default route as isDefault, without inventing a domain', () => {
    const spec: RouteSpec = {
      id: 'system-dashboard',
      isDefault: true,
      upstreams: [{ host: 'frontend', port: 3000 }],
    };

    const route = fromCaddyRoute(toCaddyRoute(spec), managedDomains);

    expect(route).toMatchObject({ id: 'system-dashboard', isDefault: true, tls: false });
    expect(route?.domain).toBeUndefined();
  });

  test('returns null for routes not managed by Zydock', () => {
    const route = fromCaddyRoute({ '@id': 'someone-elses-route' }, managedDomains);

    expect(route).toBeNull();
  });
});
