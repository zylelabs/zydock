import { describe, expect, test } from 'bun:test';
import { limitUploadStream, normalizeVolumePath } from '../../src/modules/files/files.util';

describe('normalizeVolumePath', () => {
  test('the volume root is accepted as an empty path', () => {
    expect(normalizeVolumePath('', 16)).toBe('');
  });

  test('a relative path with spaces and accents is accepted', () => {
    expect(normalizeVolumePath('configs/café menu.yml', 16)).toBe('configs/café menu.yml');
  });

  test('redundant separators and "." segments are collapsed', () => {
    expect(normalizeVolumePath('./configs//server.properties', 16)).toBe(
      'configs/server.properties',
    );
  });

  test('an absolute path is refused', () => {
    expect(() => normalizeVolumePath('/etc/passwd', 16)).toThrow();
  });

  test('a path escaping through ".." is refused', () => {
    expect(() => normalizeVolumePath('../secrets', 16)).toThrow();
    expect(() => normalizeVolumePath('configs/../../secrets', 16)).toThrow();
  });

  test('a path with a null byte is refused', () => {
    expect(() => normalizeVolumePath('configs/server.properties\0.jar', 16)).toThrow();
  });

  test('a path deeper than the configured limit is refused', () => {
    expect(() => normalizeVolumePath('a/b/c', 2)).toThrow();
    expect(normalizeVolumePath('a/b/c', 3)).toBe('a/b/c');
  });
});

const streamOf = (chunks: Uint8Array[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }

      controller.close();
    },
  });

const readAll = async (stream: ReadableStream<Uint8Array>) => {
  const reader = stream.getReader();
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();

    if (done) {
      return total;
    }

    total += value.byteLength;
  }
};

describe('limitUploadStream', () => {
  test('passes through a stream at or under the limit', async () => {
    const stream = limitUploadStream(streamOf([new Uint8Array(10), new Uint8Array(10)]), 20);

    expect(await readAll(stream)).toBe(20);
  });

  test('errors once the stream exceeds the configured maximum size', async () => {
    const stream = limitUploadStream(streamOf([new Uint8Array(10), new Uint8Array(10)]), 15);

    await expect(readAll(stream)).rejects.toThrow(/exceeds the maximum size of 15 bytes/);
  });
});
