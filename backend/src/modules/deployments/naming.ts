/**
 * Container identity shared across the deploy pipeline and everything that has to find or address a
 * running application — the logs stream, the Docker layer and the reverse proxy. It lives on its own
 * so those modules do not have to import the pipeline (and the pipeline can import the domains, which
 * need the name, without a cycle).
 */

export const APPLICATION_LABEL = 'zydock.application';
export const DEPLOYMENT_LABEL = 'zydock.deployment';
export const AUTOHEAL_LABEL = 'zydock.autoheal';

/** The container of an application keeps a stable name across deploys, so the proxy dials it once. */
export const containerNameOf = (slug: string) => `zydock-${slug}`;
