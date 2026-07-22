import { Document, model, Schema } from 'mongoose';
import { paginateStatics } from '../../utils/pagination';

const apiKeySchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'users', required: true, index: true },
    name: { type: String, required: true, trim: true },
    prefix: { type: String, required: true, index: true },
    tokenHash: { type: String, required: true, select: false },
    expiresAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    lastUsedAt: { type: Date },
  },
  {
    versionKey: false,
    timestamps: true,
    statics: paginateStatics,
  },
);

export default model('api_keys', apiKeySchema) as unknown as PaginateModel<ApiKey & Document>;
