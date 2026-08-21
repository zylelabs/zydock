import { Document, model, Schema } from 'mongoose';
import { paginateStatics } from '../../utils/pagination';
import { SERVER_STATUSES, SERVER_TYPES } from './server.schema';

const serverSchema = new Schema(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'organizations',
      index: true,
    },
    name: { type: String, required: true, trim: true },
    type: { type: String, required: true, enum: SERVER_TYPES, default: 'ssh' },
    status: { type: String, required: true, enum: SERVER_STATUSES, default: 'pending' },
    publicIp: { type: String, trim: true },
    ssh: {
      host: { type: String, trim: true },
      port: { type: Number, default: 22 },
      username: { type: String, trim: true },
      privateKey: { type: String, select: false },
      password: { type: String, select: false },
      passphrase: { type: String, select: false },
      fingerprint: { type: String },
    },
    agent: {
      host: { type: String, trim: true },
      port: { type: Number, required: true, default: 9000 },
      token: { type: String, select: false },
      version: { type: String },
      bundleHash: { type: String },
      installedAt: { type: Date },
      lastHeartbeatAt: { type: Date },
      tlsIssuedAt: { type: Date },
    },
    resources: {
      cpuCount: { type: Number },
      memoryMb: { type: Number },
      diskGb: { type: Number },
      osRelease: { type: String },
      dockerVersion: { type: String },
      composeVersion: { type: String },
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
