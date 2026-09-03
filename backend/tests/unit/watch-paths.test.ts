import { describe, expect, test } from 'bun:test';
import { matchesWatchPaths } from '../../src/modules/applications/webhook.service';

describe('matchesWatchPaths', () => {
  test('deploys when watchPaths is empty', () => {
    expect(matchesWatchPaths([], ['backend/src/a.ts'])).toBe(true);
  });

  test('matches a changed path inside the watched folder', () => {
    expect(matchesWatchPaths(['backend'], ['backend/src/a.ts'])).toBe(true);
  });

  test('does not match a sibling folder with the same prefix', () => {
    expect(matchesWatchPaths(['backend'], ['backend-legacy/a.ts'])).toBe(false);
  });

  test('deploys when changedPaths is empty (fail-open)', () => {
    expect(matchesWatchPaths(['backend'], [])).toBe(true);
  });
});
