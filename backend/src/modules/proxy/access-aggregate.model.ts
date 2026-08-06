import { Document, model, Schema } from 'mongoose';
import config from '../../config';
import { paginateStatics } from '../../utils/pagination';

const accessAggregateSchema = new Schema(
  {
    serverId: { type: Schema.Types.ObjectId, ref: 'servers', required: true, index: true },
    host: { type: String, required: true },
    minute: { type: Date, required: true },
    applicationId: { type: Schema.Types.ObjectId, ref: 'applications' },
    domainId: { type: Schema.Types.ObjectId, ref: 'domains' },
    organizationId: { type: Schema.Types.ObjectId, ref: 'organizations' },
    total: { type: Number, required: true, default: 0 },
    status2xx: { type: Number, required: true, default: 0 },
    status3xx: { type: Number, required: true, default: 0 },
    status4xx: { type: Number, required: true, default: 0 },
    status5xx: { type: Number, required: true, default: 0 },
    statusOther: { type: Number, required: true, default: 0 },
    durationSumMs: { type: Number, required: true, default: 0 },
    durationMaxMs: { type: Number, required: true, default: 0 },
    durationLe100: { type: Number, required: true, default: 0 },
    durationLe300: { type: Number, required: true, default: 0 },
    durationLe1000: { type: Number, required: true, default: 0 },
    durationLe3000: { type: Number, required: true, default: 0 },
    durationGt3000: { type: Number, required: true, default: 0 },
  },
  {
    versionKey: false,
    timestamps: { createdAt: true, updatedAt: false },
    statics: paginateStatics,
  },
);

accessAggregateSchema.index(
  { minute: 1 },
  { expireAfterSeconds: config.proxy.accessRetentionHours * 3600 },
);

accessAggregateSchema.index({ serverId: 1, host: 1, minute: 1 }, { unique: true });
accessAggregateSchema.index({ applicationId: 1, minute: -1 });

export default model('proxy_access_aggregates', accessAggregateSchema) as unknown as PaginateModel<
  AccessAggregate & Document
>;
