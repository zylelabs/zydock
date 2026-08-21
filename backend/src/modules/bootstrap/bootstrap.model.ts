import { Document, model, Schema } from 'mongoose';

const bootstrapSchema = new Schema(
  {
    codeHash: { type: String, select: false },
    attempts: { type: Number, required: true, default: 0 },
    lockedUntil: { type: Date, default: null },
    consumedAt: { type: Date, default: null },
    consumedBy: { type: Schema.Types.ObjectId, ref: 'users', default: null },
  },
  {
    versionKey: false,
    timestamps: true,
  },
);

export default model<Bootstrap & Document>('bootstraps', bootstrapSchema);
