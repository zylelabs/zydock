import { normalizeFetchError } from '~/utils';

const FORWARDED_HEADERS = ['authorization', 'content-type', 'x-api-key'];

const BODYLESS_METHODS = ['GET', 'HEAD', 'DELETE'];

/**
 * The single door between the browser and the API. Everything the client asks for goes through here,
 * so the API URL never reaches the browser — not in a request, and not in the message of a failure.
 */
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
    // `raw` because the status matters: the API answers `201` when it creates and `202` when it
    // only accepts, and the browser has to see the difference.
    const response = await $fetch.raw(target, {
      method,
      headers,
      query: getQuery(event),
      body: BODYLESS_METHODS.includes(method) ? undefined : await readBody(event),
    });

    setResponseStatus(event, response.status);

    return response._data;
  } catch (error) {
    return normalizeFetchError(event, error);
  }
});
