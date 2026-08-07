import { describe, expect, test } from 'bun:test';
import {
  isChannelDowngrade,
  updateRunPhase,
  type UpdateRun,
} from '../../app/composables/services/useUpdates';

const run = (overrides: Partial<UpdateRun> = {}): UpdateRun => ({
  id: 'run-1',
  status: 'running',
  from: 'aaaaaaa',
  to: 'bbbbbbb',
  channel: 'stable',
  startedAt: new Date().toISOString(),
  finishedAt: '',
  error: '',
  exitCode: 0,
  log: '',
  rollbackCommand: 'ZYDOCK_REF=aaaaaaa bash /data/zydock/scripts/update.sh',
  ...overrides,
});

describe('updateRunPhase', () => {
  test('no update in progress and nothing dispatched yet is idle', () => {
    expect(updateRunPhase(null, false)).toBe('idle');
  });

  test('dispatched but the first poll has not answered yet is updating', () => {
    expect(updateRunPhase(null, true)).toBe('updating');
  });

  test('a running run, including through a poll error, is updating', () => {
    expect(updateRunPhase(run({ status: 'running' }), true)).toBe('updating');
    expect(updateRunPhase(run({ status: 'running' }), false)).toBe('updating');
  });

  test('a finished run maps status to phase', () => {
    expect(updateRunPhase(run({ status: 'success' }), false)).toBe('succeeded');
    expect(updateRunPhase(run({ status: 'failed', error: 'healthcheck timeout' }), false)).toBe(
      'failed',
    );
    expect(updateRunPhase(run({ status: 'unknown' }), false)).toBe('unknown');
  });
});

describe('isChannelDowngrade', () => {
  test('moving to stable from any other channel is a downgrade', () => {
    expect(isChannelDowngrade('nightly', 'stable')).toBeTrue();
    expect(isChannelDowngrade('dev', 'stable')).toBeTrue();
    expect(isChannelDowngrade('branch', 'stable')).toBeTrue();
  });

  test('anything that does not land on stable is not flagged', () => {
    expect(isChannelDowngrade('stable', 'nightly')).toBeFalse();
    expect(isChannelDowngrade('nightly', 'dev')).toBeFalse();
    expect(isChannelDowngrade('dev', 'branch')).toBeFalse();
    expect(isChannelDowngrade('stable', 'stable')).toBeFalse();
  });
});
