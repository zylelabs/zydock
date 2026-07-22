import config from '../../config';
import { resolveContainerProvider, type LogEntry } from '../../providers/container';
import { errorMessage } from '../../utils';
import { logDebug, logError } from '../../utils/logger';
import applicationModel from '../applications/application.model';
import { APPLICATION_LABEL } from '../deployments/pipeline.service';
import { buildAgentConnection, findServerById } from '../servers/server.service';
import {
  publish,
  publishToClient,
  registerTopicListener,
  type TopicEvent,
} from '../websocket/websocket.service';

const CHANNEL = 'logs';

type LiveStream = {
  abort: AbortController;
  /** Last lines delivered, so whoever arrives later does not stare at an empty screen. */
  recent: LogEntry[];
};

const streams = new Map<string, LiveStream>();

export const logTopicOf = (applicationId: string) => `application:${applicationId}:${CHANNEL}`;

const remember = (stream: LiveStream, entry: LogEntry) => {
  stream.recent.push(entry);

  if (stream.recent.length > config.logs.streamTail) {
    stream.recent.shift();
  }
};

/**
 * Follows the logs of the container currently running the application and republishes every line to
 * the topic. One stream serves every subscriber: the agent is asked once, no matter how many people
 * are watching.
 */
const openStream = async (topic: string, applicationId: string) => {
  const stream: LiveStream = { abort: new AbortController(), recent: [] };

  streams.set(topic, stream);

  try {
    const application = await applicationModel.findById(applicationId);

    if (!application) {
      throw new Error('Application not found');
    }

    const server = await findServerById(String(application.serverId));

    if (!server) {
      throw new Error('Server not found');
    }

    const containers = resolveContainerProvider(buildAgentConnection(server));

    const [container] = await containers.listContainers({
      labels: { [APPLICATION_LABEL]: applicationId },
    });

    if (!container) {
      publish(topic, 'ended', { reason: 'This application has no container running' });
      return;
    }

    publish(topic, 'started', { containerId: container.id, name: container.name });

    logDebug('Log stream opened', { topic, container: container.id });

    for await (const entry of containers.streamLogs(container.id, {
      tail: config.logs.streamTail,
      signal: stream.abort.signal,
    })) {
      remember(stream, entry);
      publish(topic, 'log', entry);
    }

    // Aborting is how the last subscriber closes the stream: nobody is left to be told about it.
    if (!stream.abort.signal.aborted) {
      publish(topic, 'ended', { reason: 'The container stopped writing logs' });
    }
  } catch (error) {
    publish(topic, 'ended', { reason: errorMessage(error) });

    logError('Log stream failed', error, { topic });
  } finally {
    // Only if it is still this stream: a new audience may have opened another one in the meantime.
    if (streams.get(topic) === stream) {
      streams.delete(topic);
    }
  }
};

const closeStream = (topic: string) => {
  const stream = streams.get(topic);

  if (!stream) {
    return;
  }

  streams.delete(topic);
  stream.abort.abort();

  logDebug('Log stream closed', { topic });
};

const onSubscribed = (event: TopicEvent) => {
  if (event.channel !== CHANNEL) {
    return;
  }

  const stream = streams.get(event.topic);

  if (!stream) {
    void openStream(event.topic, event.resourceId);
    return;
  }

  for (const entry of stream.recent) {
    publishToClient(event.clientId, event.topic, 'log', entry);
  }
};

const onUnsubscribed = (event: TopicEvent) => {
  if (event.channel !== CHANNEL || event.subscribers > 0) {
    return;
  }

  closeStream(event.topic);
};

registerTopicListener('application', { subscribed: onSubscribed, unsubscribed: onUnsubscribed });

/** Shutdown: closing the streams releases the connections held open against the agents. */
export const stopLogStreams = () => {
  for (const topic of [...streams.keys()]) {
    closeStream(topic);
  }
};
