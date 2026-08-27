import { describe, expect, test } from 'bun:test';
import { resolveMongoCredentials } from '../../src/modules/installation/installation.service';

describe('resolveMongoCredentials', () => {
  test('prefers the explicit username and password', () => {
    expect(
      resolveMongoCredentials({
        MONGO_USERNAME: 'zydock',
        MONGO_PASSWORD: 'secret',
        MONGO_URI: 'mongodb://other:pass@mongo:27017/zydock?authSource=admin',
      }),
    ).toEqual({ username: 'zydock', password: 'secret' });
  });

  test('falls back to the credentials carried by the URI', () => {
    expect(
      resolveMongoCredentials({
        MONGO_URI: 'mongodb://zydock:s3%40cret@mongo:27017/zydock?authSource=admin',
      }),
    ).toEqual({ username: 'zydock', password: 's3@cret' });
  });

  test('returns null when the installation has no credentials', () => {
    expect(resolveMongoCredentials({ MONGO_URI: 'mongodb://mongo:27017/zydock' })).toBeNull();
    expect(resolveMongoCredentials({})).toBeNull();
  });
});
