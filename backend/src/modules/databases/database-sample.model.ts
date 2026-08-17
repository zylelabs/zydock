import { Document, model, Schema } from 'mongoose';
import config from '../../config';
import { paginateStatics } from '../../utils/pagination';

const databaseSampleSchema = new Schema(
  {
    databaseId: { type: Schema.Types.ObjectId, ref: 'databases', required: true, index: true },
    capturedAt: { type: Date, required: true },
    connections: { type: Number },
    maxConnections: { type: Number },
    sizeBytes: { type: Number },
  },
  {
    versionKey: false,
    timestamps: { createdAt: true, updatedAt: false },
    statics: paginateStatics,
  },
);

databaseSampleSchema.index(
  { capturedAt: 1 },
  { expireAfterSeconds: config.databaseMetrics.retentionHours * 3600 },
);

databaseSampleSchema.index({ databaseId: 1, capturedAt: -1 });

export default model('database_samples', databaseSampleSchema) as unknown as PaginateModel<
  DatabaseSample & Document
>;
