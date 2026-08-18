import { stringify } from 'yaml';
import config from '../../config';
import { logWarn } from '../../utils/logger';
import { APPLICATION_LABEL, AUTOHEAL_LABEL, DEPLOYMENT_LABEL } from '../deployments/naming';
import { memoryLimitToMb } from './compose.service';

type OverrideService = Pick<ParsedComposeService, 'name' | 'memoryLimit'>;

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
    const declaredMb = memoryLimitToMb(service.memoryLimit);

    if (application.resources?.memoryMb) {
      if (declaredMb && application.resources.memoryMb < declaredMb) {
        logWarn('Memory limit is lower than the one declared in the compose file', {
          application: String(application._id),
          service: service.name,
          memoryMb: application.resources.memoryMb,
          composeMemoryMb: declaredMb,
        });
      }

      return `${application.resources.memoryMb}M`;
    }

    if (service.memoryLimit) {
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
