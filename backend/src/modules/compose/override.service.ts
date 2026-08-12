import { stringify } from 'yaml';
import config from '../../config';
import { APPLICATION_LABEL, AUTOHEAL_LABEL, DEPLOYMENT_LABEL } from '../deployments/naming';

type OverrideService = Pick<ParsedComposeService, 'name' | 'hasMemoryLimit'>;

export const renderOverrideDocument = (
  services: OverrideService[],
  application: Application,
  deploymentId: string,
): string => {
  const labelsOf = () => ({
    [APPLICATION_LABEL]: String(application._id),
    [DEPLOYMENT_LABEL]: deploymentId,
    ...(application.restartPolicy !== 'no' ? { [AUTOHEAL_LABEL]: 'true' } : {}),
  });

  const memoryLimitFor = (service: OverrideService): string | undefined => {
    if (application.resources?.memoryMb) {
      return `${application.resources.memoryMb}M`;
    }

    if (service.hasMemoryLimit) {
      return undefined;
    }

    return `${config.compose.defaultMemoryLimitMb}M`;
  };

  const resourceLimitsFor = (service: OverrideService) => {
    const cpus = application.resources?.cpus;
    const memory = memoryLimitFor(service);

    if (!cpus && !memory) {
      return {};
    }

    return {
      deploy: {
        resources: {
          limits: {
            ...(cpus ? { cpus: String(cpus) } : {}),
            ...(memory ? { memory } : {}),
          },
        },
      },
    };
  };

  const document = {
    services: Object.fromEntries(
      services.map(service => [
        service.name,
        {
          labels: labelsOf(),
          networks: [config.proxy.network],
          restart: application.restartPolicy,
          ...resourceLimitsFor(service),
        },
      ]),
    ),
    networks: {
      [config.proxy.network]: { external: true },
    },
  };

  return stringify(document);
};
