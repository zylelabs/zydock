import { Document, model, Schema } from 'mongoose';
import { paginateStatics } from '../../utils/pagination';
import { SERVER_STATUSES } from './server.schema';

const serverSchema = new Schema(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'organizations',
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    status: { type: String, required: true, enum: SERVER_STATUSES, default: 'pending' },
    ssh: {
      host: { type: String, required: true, trim: true },
      port: { type: Number, required: true, default: 22 },
      username: { type: String, required: true, trim: true },
      privateKey: { type: String, select: false },
      password: { type: String, select: false },
      passphrase: { type: String, select: false },
      fingerprint: { type: String },
    },
    agent: {
      port: { type: Number, required: true, default: 9000 },
      token: { type: String, select: false },
      version: { type: String },
      installedAt: { type: Date },
      lastHeartbeatAt: { type: Date },
    },
    resources: {
      cpuCount: { type: Number },
      memoryMb: { type: Number },
      diskGb: { type: Number },
      osRelease: { type: String },
      dockerVersion: { type: String },
    },
    lastError: { type: String },
  },
  {
    versionKey: false,
    timestamps: true,
    statics: paginateStatics,
  },
);

export default model('servers', serverSchema) as unknown as PaginateModel<Server & Document>;
