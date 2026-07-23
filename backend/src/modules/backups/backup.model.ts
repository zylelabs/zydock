import { Document, model, Schema } from 'mongoose';
import { paginateStatics } from '../../utils/pagination';
import { BACKUP_STATUSES, BACKUP_TYPES } from './backup.schema';

const backupSchema = new Schema(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'organizations',
      required: true,
      index: true,
    },
    type: { type: String, required: true, enum: BACKUP_TYPES },
    status: { type: String, required: true, enum: BACKUP_STATUSES, default: 'running' },
    // Only the target of this kind of backup is filled: a database, or a volume on a server.
    serverId: { type: Schema.Types.ObjectId, ref: 'servers' },
    databaseId: { type: Schema.Types.ObjectId, ref: 'databases' },
    applicationId: { type: Schema.Types.ObjectId, ref: 'applications' },
    volumeName: { type: String, trim: true },
    engine: { type: String },
    label: { type: String, required: true },
    storageKey: { type: String, required: true },
    sizeBytes: { type: Number },
    error: { type: String },
    finishedAt: { type: Date },
    durationMs: { type: Number },
    // A restore is long too, so it runs in the queue and reports back on the same record.
    restoreStatus: { type: String, enum: BACKUP_STATUSES },
    restoreError: { type: String },
    lastRestoredAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: 'users' },
  },
  {
    versionKey: false,
    timestamps: true,
    statics: paginateStatics,
  },
);

// The listing is always "this organization, most recent first".
backupSchema.index({ organizationId: 1, createdAt: -1 });

export default model('backups', backupSchema) as unknown as PaginateModel<Backup & Document>;
