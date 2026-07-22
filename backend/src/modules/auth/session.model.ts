import { Document, model, Schema } from 'mongoose';
import { paginateStatics } from '../../utils/pagination';

const AUDIT_RETENTION_SECONDS = 60 * 60 * 24 * 90;

const sessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'users', required: true, index: true },
    refreshTokenHash: { type: String, required: true, select: false, index: true },
    userAgent: { type: String },
    ip: { type: String },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    lastUsedAt: { type: Date },
  },
  {
    versionKey: false,
    timestamps: true,
    statics: paginateStatics,
  },
);

sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: AUDIT_RETENTION_SECONDS });

export default model('sessions', sessionSchema) as unknown as PaginateModel<Session & Document>;
