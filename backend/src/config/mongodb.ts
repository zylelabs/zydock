import mongoose from 'mongoose';
import { logError, logInfo } from '../utils/logger';
import config from './index';

const CONNECTION_STATES: Record<number, string> = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
};

let isConnected = false;

const syncIndexes = async () => {
  const models = Object.entries(mongoose.models);
  const results = await Promise.allSettled(models.map(([, model]) => model.createIndexes()));

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      return;
    }

    logError(`Failed to sync indexes for model "${models[index]?.[0]}"`, result.reason);
  });
};

export const connectDatabase = async () => {
  if (isConnected) {
    return;
  }

  await mongoose.connect(config.mongodb.uri, { autoIndex: config.mode !== 'prod' });
  isConnected = true;

  await syncIndexes();

  logInfo('MongoDB connected');
};

export const disconnectDatabase = async () => {
  if (!isConnected) {
    return;
  }

  await mongoose.disconnect();
  isConnected = false;

  logInfo('MongoDB disconnected');
};

export const getDatabaseStatus = () => {
  const readyState = mongoose.connection.readyState;

  return {
    connected: readyState === 1,
    state: CONNECTION_STATES[readyState] ?? 'unknown',
  };
};
