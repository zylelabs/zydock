import { Document, model, Schema } from 'mongoose';
import { paginateStatics } from '../../utils/pagination';
import { AUDIT_LOG_ACTIONS } from './audit-log.schema';

const AUDIT_LOG_RETENTION_SECONDS = 60 * 60 * 24 * 90;

const auditLogSchema = new Schema(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'organizations',
      required: true,
      index: true,
    },
    userId: { type: Schema.Types.ObjectId, ref: 'users', required: true },
    serverId: { type: Schema.Types.ObjectId, ref: 'servers', required: true },
    action: { type: String, required: true, enum: AUDIT_LOG_ACTIONS },
    containerId: { type: String },
    volume: { type: String },
    path: { type: String },
    startedAt: { type: Date, required: true },
    endedAt: { type: Date },
  },
  {
    versionKey: false,
    timestamps: true,
    statics: paginateStatics,
  },
);

auditLogSchema.index({ organizationId: 1, createdAt: -1 });

auditLogSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: AUDIT_LOG_RETENTION_SECONDS },
);

export default model('audit_logs', auditLogSchema) as unknown as PaginateModel<
  AuditLog & Document
>;
