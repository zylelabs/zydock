import { Document, model, Schema } from 'mongoose';
import { paginateStatics } from '../../utils/pagination';
import { ORGANIZATION_ROLES } from './membership.schema';

const RETENTION_SECONDS = 60 * 60 * 24 * 30;

const inviteSchema = new Schema(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'organizations',
      required: true,
      index: true,
    },
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    role: { type: String, required: true, enum: ORGANIZATION_ROLES },
    tokenHash: { type: String, required: true, select: false, index: true },
    invitedBy: { type: Schema.Types.ObjectId, ref: 'users', required: true },
    expiresAt: { type: Date, required: true },
    acceptedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
  },
  {
    versionKey: false,
    timestamps: true,
    statics: paginateStatics,
  },
);

inviteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: RETENTION_SECONDS });

export default model('invites', inviteSchema) as unknown as PaginateModel<Invite & Document>;
