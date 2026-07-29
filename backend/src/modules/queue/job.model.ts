import { Document, model, Schema } from 'mongoose';
import { paginateStatics } from '../../utils/pagination';
import { JOB_STATUSES } from './queue.schema';

const jobSchema = new Schema(
  {
    type: { type: String, required: true, trim: true, index: true },
    payload: { type: Schema.Types.Mixed, required: true, default: {} },
    status: { type: String, required: true, enum: JOB_STATUSES, default: 'pending' },
    attempts: { type: Number, required: true, default: 0 },
    maxAttempts: { type: Number, required: true, default: 3 },
    runAt: { type: Date, required: true, default: () => new Date() },
    startedAt: { type: Date },
    finishedAt: { type: Date },
    lockedBy: { type: String },
    lastError: { type: String },
  },
  {
    versionKey: false,
    timestamps: true,
    statics: paginateStatics,
  },
);

jobSchema.index({ status: 1, runAt: 1 });

export default model('jobs', jobSchema) as unknown as PaginateModel<Job & Document>;
