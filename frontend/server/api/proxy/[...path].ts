import { normalizeFetchError } from '~/utils';

const FORWARDED_HEADERS = ['authorization', 'content-type', 'x-api-key'];

const BODYLESS_METHODS = ['GET', 'HEAD', 'DELETE'];

export default defineEventHandler(async event => {
  const { urlApi } = useRuntimeConfig(event);

  const path = event.context.params?.path ?? '';
  const target = `${urlApi}/api/${Array.isArray(path) ? path.join('/') : path}`;

  const method = event.method;
  const headers = Object.fromEntries(
    FORWARDED_HEADERS.map(name => [name, event.headers.get(name) ?? '']).filter(
      ([, value]) => value,
    ),
  );

  try {
    const response = await $fetch.raw(target, {
      method,
      headers,
      query: getQuery(event),
      body: BODYLESS_METHODS.includes(method) ? undefined : await readBody(event),
    });

    setResponseStatus(event, response.status);

    if (response._data instanceof Blob) {
      const contentType = response.headers.get('content-type');
      const contentDisposition = response.headers.get('content-disposition');

      if (contentType) {
        setResponseHeader(event, 'content-type', contentType);
      }

      if (contentDisposition) {
        setResponseHeader(event, 'content-disposition', contentDisposition);
      }

      return Buffer.from(await response._data.arrayBuffer());
    }

    return response._data;
  } catch (error) {
    return normalizeFetchError(event, error);
  }
});
