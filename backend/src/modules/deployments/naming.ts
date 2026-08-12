export const APPLICATION_LABEL = 'zydock.application';
export const DEPLOYMENT_LABEL = 'zydock.deployment';
export const AUTOHEAL_LABEL = 'zydock.autoheal';

export const containerNameOf = (slug: string) => `zydock-${slug}`;

export const composeProjectOf = (slug: string) => slug;

export const composeContainerNameOf = (slug: string, service: string) =>
  `zydock-${slug}-${service}-1`;
