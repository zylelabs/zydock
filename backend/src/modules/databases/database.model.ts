import { Document, model, Schema } from 'mongoose';
import { DATABASE_ENGINES } from '../../providers/database/database.contract';
import { paginateStatics } from '../../utils/pagination';
import { DATABASE_INSTANCE_STATUSES, DATABASE_SOURCES } from './database.schema';

const credentialsSchema = new Schema(
  {
    host: { type: String, required: true },
    port: { type: Number, required: true },
    username: { type: String, required: true },
    database: { type: String, required: true },
    password: { type: String, required: true, select: false },
    connectionUri: { type: String, required: true, select: false },
  },
  { _id: false },
);

const credentialRefSchema = new Schema(
  {
    key: { type: String },
    value: { type: String },
  },
  { _id: false },
);

const composeLinkSchema = new Schema(
  {
    applicationId: {
      type: Schema.Types.ObjectId,
      ref: 'applications',
      required: true,
      index: true,
    },
    service: { type: String, required: true },
    username: { type: credentialRefSchema },
    password: { type: credentialRefSchema, required: true },
    database: { type: credentialRefSchema },
  },
  { _id: false },
);

const databaseSchema = new Schema(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'organizations',
      required: true,
      index: true,
    },
    serverId: { type: Schema.Types.ObjectId, ref: 'servers', required: true, index: true },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true, lowercase: true },
    engine: { type: String, required: true, enum: DATABASE_ENGINES },
    version: {
      type: String,
      required(this: { source?: string }) {
        return this.source !== 'compose';
      },
    },
    status: {
      type: String,
      required: true,
      enum: DATABASE_INSTANCE_STATUSES,
      default: 'provisioning',
    },
    source: { type: String, required: true, enum: DATABASE_SOURCES, default: 'managed' },
    containerId: { type: String },
    containerName: { type: String },
    credentials: {
      type: credentialsSchema,
      required(this: { source?: string }) {
        return this.source !== 'compose';
      },
    },
    link: {
      type: composeLinkSchema,
      required(this: { source?: string }) {
        return this.source === 'compose';
      },
    },
    lastError: { type: String },
  },
  {
    versionKey: false,
    timestamps: true,
    statics: paginateStatics,
  },
);

databaseSchema.index({ serverId: 1, slug: 1 }, { unique: true });

export default model('databases', databaseSchema) as unknown as PaginateModel<
  ManagedDatabase & Document
>;
