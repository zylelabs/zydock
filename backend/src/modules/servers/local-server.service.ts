import config from '../../config';
import { encryptSecret } from '../../utils/crypto';
import { logInfo, logWarn } from '../../utils/logger';
import serverModel from './server.model';
import { isPublicIp } from './server.service';

let localServerId: string | undefined;

export const getLocalServerId = () => localServerId;

export const isLocalServer = (server: Pick<Server, '_id'>) =>
  Boolean(localServerId) && String(server._id) === localServerId;

export const ensureLocalServer = async () => {
  if (!config.localServer.token) {
    logWarn('LOCAL_AGENT_TOKEN not configured, skipping local server bootstrap');
    return;
  }

  const candidates = await serverModel.find({ type: 'local' }).sort({ createdAt: 1 });
  const [primary, ...extras] = candidates;

  const encryptedToken = encryptSecret(config.localServer.token);
  const detectedPublicIp = isPublicIp(config.localServer.publicIp)
    ? config.localServer.publicIp
    : undefined;

  if (primary) {
    const set: Record<string, unknown> = {
      'agent.host': config.localServer.agentHost,
      'agent.port': config.localServer.agentPort,
      'agent.token': encryptedToken,
    };

    if (detectedPublicIp && !primary.publicIp) {
      set.publicIp = detectedPublicIp;
    }

    await serverModel.updateOne(
      { _id: primary._id },
      { $set: set, $unset: { organizationId: '' } },
    );

    localServerId = String(primary._id);
    logInfo('Local server adopted', { serverId: localServerId });
  } else {
    const created = await serverModel.create({
      name: config.localServer.name,
      type: 'local',
      status: 'pending',
      publicIp: detectedPublicIp,
      agent: {
        host: config.localServer.agentHost,
        port: config.localServer.agentPort,
        token: encryptedToken,
      },
    });

    localServerId = String(created._id);
    logInfo('Local server created', { serverId: localServerId });
  }

  if (extras.length) {
    logWarn('Multiple local servers found, only the oldest was adopted as the system server', {
      extraServerIds: extras.map(server => String(server._id)),
    });
  }
};
