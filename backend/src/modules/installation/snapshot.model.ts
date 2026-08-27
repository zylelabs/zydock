import { Document, model, Schema } from 'mongoose';
import { SNAPSHOT_STATUSES } from './snapshot.schema';

const snapshotSchema = new Schema(
  {
    storageKey: { type: String, required: true },
    sizeBytes: { type: Number },
    includesApplicationData: { type: Boolean, default: false },
    version: { type: String },
    commit: { type: String },
    status: { type: String, required: true, enum: SNAPSHOT_STATUSES, default: 'running' },
    error: { type: String },
    finishedAt: { type: Date },
    durationMs: { type: Number },
    createdBy: { type: Schema.Types.ObjectId, ref: 'users' },
  },
  {
    versionKey: false,
    timestamps: true,
  },
);

export default model<InstallationSnapshot & Document>('installation_snapshots', snapshotSchema);
