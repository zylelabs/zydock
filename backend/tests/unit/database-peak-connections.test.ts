import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../../src/config/mongodb';
import databaseSampleModel from '../../src/modules/databases/database-sample.model';
import { peakConnectionsOf } from '../../src/modules/databases/database-sample.service';

const databaseId = new mongoose.Types.ObjectId();
const otherDatabaseId = new mongoose.Types.ObjectId();

const sampleAt = (databaseId: mongoose.Types.ObjectId, connections: number, hoursAgo: number) =>
  databaseSampleModel.create({
    databaseId,
    capturedAt: new Date(Date.now() - hoursAgo * 60 * 60 * 1000),
    connections,
  });

beforeAll(async () => {
  await connectDatabase();
});

afterEach(async () => {
  await databaseSampleModel.deleteMany({ databaseId: { $in: [databaseId, otherDatabaseId] } });
});

afterAll(async () => {
  await disconnectDatabase();
});

describe('peakConnectionsOf', () => {
  test('a sample outside the window is ignored', async () => {
    await sampleAt(databaseId, 50, 1);
    await sampleAt(databaseId, 999, 30);

    const peaks = await peakConnectionsOf([String(databaseId)], 24);

    expect(peaks.get(String(databaseId))).toBe(50);
  });

  test('a database with no samples has no entry in the map', async () => {
    const peaks = await peakConnectionsOf([String(databaseId)], 24);

    expect(peaks.has(String(databaseId))).toBe(false);
  });

  test('$max is taken across multiple samples within the window', async () => {
    await sampleAt(databaseId, 12, 1);
    await sampleAt(databaseId, 118, 5);
    await sampleAt(databaseId, 40, 10);

    const peaks = await peakConnectionsOf([String(databaseId)], 24);

    expect(peaks.get(String(databaseId))).toBe(118);
  });

  test('resolves peaks for multiple databases in a single query', async () => {
    await sampleAt(databaseId, 7, 1);
    await sampleAt(otherDatabaseId, 22, 1);

    const peaks = await peakConnectionsOf([String(databaseId), String(otherDatabaseId)], 24);

    expect(peaks.get(String(databaseId))).toBe(7);
    expect(peaks.get(String(otherDatabaseId))).toBe(22);
  });

  test('an empty list of database ids resolves to an empty map without querying', async () => {
    const peaks = await peakConnectionsOf([], 24);

    expect(peaks.size).toBe(0);
  });
});
