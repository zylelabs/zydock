import { Document, model, Schema } from 'mongoose';

const RETENTION_SECONDS = 60 * 60 * 24;

const passwordResetSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'users', required: true, index: true },
    tokenHash: { type: String, required: true, select: false, index: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
  },
  {
    versionKey: false,
    timestamps: true,
  },
);

passwordResetSchema.index({ expiresAt: 1 }, { expireAfterSeconds: RETENTION_SECONDS });

export default model<PasswordReset & Document>('password_resets', passwordResetSchema);
