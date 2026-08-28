import { describe, expect, test } from 'bun:test';
import {
  parseDockerfile,
  stagesOf,
  undeclaredBuildArgs,
  undeclaredBuildSecrets,
  withInjectedArgs,
} from '../../src/utils/dockerfile';

describe('parseDockerfile', () => {
  test('ignores comments and blank lines, joins line continuations', () => {
    const instructions = parseDockerfile(
      ['# a comment', '', 'RUN echo a \\', '  && echo b', 'ARG FOO'].join('\n'),
    );

    expect(instructions).toEqual([
      { instruction: 'RUN', args: 'echo a && echo b', startLine: 2, endLine: 3 },
      { instruction: 'ARG', args: 'FOO', startLine: 4, endLine: 4 },
    ]);
  });
});

describe('undeclaredBuildArgs', () => {
  test('Dockerfile starting with a comment: ARG declared in the stage is consumed', () => {
    const dockerfile = ['# my app', 'FROM node:20', 'ARG FOO', 'RUN echo $FOO'].join('\n');

    expect(undeclaredBuildArgs(dockerfile, ['FOO'])).toEqual([]);
  });

  test('# syntax= directive before FROM does not count as a stage declaration', () => {
    const dockerfile = [
      '# syntax=docker/dockerfile:1',
      'ARG FOO',
      'FROM node:20',
      'RUN echo hi',
    ].join('\n');

    expect(undeclaredBuildArgs(dockerfile, ['FOO'])).toEqual(['FOO']);
  });

  test('multi-stage: declared in at least one stage is enough to not warn', () => {
    const dockerfile = [
      'FROM node:20 AS build',
      'ARG FOO',
      'RUN echo $FOO',
      'FROM node:20 AS run',
      'RUN echo hi',
    ].join('\n');

    expect(undeclaredBuildArgs(dockerfile, ['FOO'])).toEqual([]);
  });

  test('multi-stage: declared in no stage is reported', () => {
    const dockerfile = [
      'FROM node:20 AS build',
      'RUN echo hi',
      'FROM node:20 AS run',
      'RUN echo hi',
    ].join('\n');

    expect(undeclaredBuildArgs(dockerfile, ['FOO'])).toEqual(['FOO']);
  });

  test('ARG already declared in every stage is not reported', () => {
    const dockerfile = ['FROM node:20 AS build', 'ARG FOO', 'FROM node:20 AS run', 'ARG FOO'].join(
      '\n',
    );

    expect(undeclaredBuildArgs(dockerfile, ['FOO'])).toEqual([]);
  });

  test('line continuation inside RUN does not break stage detection', () => {
    const dockerfile = [
      'FROM node:20',
      'ARG FOO',
      'RUN echo start \\',
      '  && echo $FOO \\',
      '  && echo end',
    ].join('\n');

    expect(undeclaredBuildArgs(dockerfile, ['FOO'])).toEqual([]);
  });
});

describe('undeclaredBuildSecrets', () => {
  test('reports ids with no matching RUN --mount=type=secret', () => {
    const dockerfile = ['FROM node:20', 'RUN --mount=type=secret,id=FOO cat /run/secrets/FOO'].join(
      '\n',
    );

    expect(undeclaredBuildSecrets(dockerfile, ['FOO', 'BAR'])).toEqual(['BAR']);
  });
});

describe('withInjectedArgs', () => {
  test('inserts ARG right after each FROM, in multi-stage, skipping already-declared stages', () => {
    const dockerfile = [
      'FROM node:20 AS build',
      'RUN echo hi',
      'FROM node:20 AS run',
      'ARG FOO',
      'RUN echo hi',
    ].join('\n');

    const injected = withInjectedArgs(dockerfile, ['FOO']);

    expect(injected).toBe(
      [
        'FROM node:20 AS build',
        'ARG FOO',
        'RUN echo hi',
        'FROM node:20 AS run',
        'ARG FOO',
        'RUN echo hi',
      ].join('\n'),
    );
  });

  test('does not touch content before the first FROM', () => {
    const dockerfile = [
      '# syntax=docker/dockerfile:1',
      '# license header',
      'FROM node:20',
      'RUN echo hi',
    ].join('\n');

    const injected = withInjectedArgs(dockerfile, ['FOO']);

    expect(
      injected.startsWith('# syntax=docker/dockerfile:1\n# license header\nFROM node:20\nARG FOO'),
    ).toBe(true);
  });

  test('does not insert inside a line-continuation instruction', () => {
    const dockerfile = ['FROM node:20 \\', '  AS build', 'RUN echo hi'].join('\n');

    const injected = withInjectedArgs(dockerfile, ['FOO']);
    const lines = injected.split('\n');

    expect(lines[0]).toBe('FROM node:20 \\');
    expect(lines[1]).toBe('  AS build');
    expect(lines[2]).toBe('ARG FOO');
  });

  test('returns the content unchanged when there is nothing to inject', () => {
    const dockerfile = ['FROM node:20', 'ARG FOO', 'RUN echo $FOO'].join('\n');

    expect(withInjectedArgs(dockerfile, ['FOO'])).toBe(dockerfile);
  });

  test('preserves the original CRLF line ending', () => {
    const dockerfile = ['FROM node:20', 'RUN echo hi'].join('\r\n');

    const injected = withInjectedArgs(dockerfile, ['FOO']);

    expect(injected).toBe(['FROM node:20', 'ARG FOO', 'RUN echo hi'].join('\r\n'));
  });
});
