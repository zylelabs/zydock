import { Document, model, Schema } from 'mongoose';
import { DATABASE_ENGINES } from '../../providers/database/database.contract';
import { paginateStatics } from '../../utils/pagination';
import { DATABASE_INSTANCE_STATUSES } from './database.schema';

const credentialsSchema = new Schema(
  {
    host: { type: String, required: true },
    port: { type: Number, required: true },
    username: { type: String, required: true },
    database: { type: String, required: true },
    // Encrypted, never hashed: the platform must return them so applications can connect. The URI
    // is stored (not rebuilt) because its shape is engine-specific and already carries the password.
    password: { type: String, required: true, select: false },
    connectionUri: { type: String, required: true, select: false },
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
    version: { type: String, required: true },
    status: {
      type: String,
      required: true,
      enum: DATABASE_INSTANCE_STATUSES,
      default: 'provisioning',
    },
    containerId: { type: String },
    containerName: { type: String },
    credentials: { type: credentialsSchema, required: true },
    lastError: { type: String },
  },
  {
    versionKey: false,
    timestamps: true,
    statics: paginateStatics,
  },
);

// A slug names the database inside its server: the container is `zydock-db-<slug>`, unique per host.
databaseSchema.index({ serverId: 1, slug: 1 }, { unique: true });

export default model('databases', databaseSchema) as unknown as PaginateModel<
  ManagedDatabase & Document
>;
