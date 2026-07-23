import { Document, model, Schema } from 'mongoose';
import config from '../../config';
import { paginateStatics } from '../../utils/pagination';

const metricSampleSchema = new Schema(
  {
    serverId: { type: Schema.Types.ObjectId, ref: 'servers', required: true, index: true },
    capturedAt: { type: Date, required: true },
    cpuPercent: { type: Number },
    memoryUsedMb: { type: Number },
    memoryTotalMb: { type: Number },
    diskUsedGb: { type: Number },
    diskTotalGb: { type: Number },
    networkRxBytes: { type: Number },
    networkTxBytes: { type: Number },
    containersRunning: { type: Number },
    containersTotal: { type: Number },
  },
  {
    versionKey: false,
    // No `updatedAt`: a sample is written once and never touched.
    timestamps: { createdAt: true, updatedAt: false },
    statics: paginateStatics,
  },
);

// History is bounded by a TTL — old samples expire on their own, so the collection cannot grow
// without limit. The window comes from config, evaluated once at model definition.
metricSampleSchema.index(
  { capturedAt: 1 },
  { expireAfterSeconds: config.metrics.retentionHours * 3600 },
);

// The history query is always "this server, most recent first".
metricSampleSchema.index({ serverId: 1, capturedAt: -1 });

export default model('metric_samples', metricSampleSchema) as unknown as PaginateModel<
  MetricSample & Document
>;
