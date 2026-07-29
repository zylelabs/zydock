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
    timestamps: { createdAt: true, updatedAt: false },
    statics: paginateStatics,
  },
);

metricSampleSchema.index(
  { capturedAt: 1 },
  { expireAfterSeconds: config.metrics.retentionHours * 3600 },
);

metricSampleSchema.index({ serverId: 1, capturedAt: -1 });

export default model('metric_samples', metricSampleSchema) as unknown as PaginateModel<
  MetricSample & Document
>;
