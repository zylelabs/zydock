import { Document, model, Schema } from 'mongoose';
import { INSTALLATION_ROLES } from './installation.schema';

const replicaSchema = new Schema(
  {
    host: { type: String, trim: true },
    publicIp: { type: String, trim: true },
    version: { type: String, trim: true },
    snapshotAt: { type: Date },
  },
  { _id: false },
);

const installationSchema = new Schema(
  {
    role: { type: String, required: true, enum: INSTALLATION_ROLES, default: 'active' },
    standbySince: { type: Date },
    promotedAt: { type: Date },
    demotedAt: { type: Date },
    dataFrom: { type: Date },
    replicaOf: { type: replicaSchema },
    lastSnapshotAt: { type: Date },
    lastRestoreRunId: { type: String },
    note: { type: String, trim: true },
  },
  {
    versionKey: false,
    timestamps: true,
  },
);

export default model<Installation & Document>('installations', installationSchema);
