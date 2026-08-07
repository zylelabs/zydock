import { Document, model, Schema } from 'mongoose';
import {
  randomCheckMinute,
  UPDATE_CHANNELS,
  UPDATE_CHECK_SOURCES,
  UPDATE_FREQUENCIES,
} from './update.schema';

const updateSchema = new Schema(
  {
    channel: { type: String, required: true, enum: UPDATE_CHANNELS, default: 'stable' },
    branch: { type: String, trim: true, default: '' },
    auto: { type: Boolean, required: true, default: false },
    frequency: { type: String, required: true, enum: UPDATE_FREQUENCIES, default: 'daily' },
    checkMinute: { type: Number, required: true, default: randomCheckMinute },
    remoteVersion: { type: String },
    remoteCommit: { type: String },
    nextCheckAt: { type: Date },
    lastCheckedAt: { type: Date },
    lastCheckSource: { type: String, enum: UPDATE_CHECK_SOURCES },
    lastCheckError: { type: String },
    lastRunId: { type: String },
    lastNotifiedCommit: { type: String },
    lastNotifiedRunId: { type: String },
  },
  {
    versionKey: false,
    timestamps: true,
  },
);

export default model<Update & Document>('updates', updateSchema);
