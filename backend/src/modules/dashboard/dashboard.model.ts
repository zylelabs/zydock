import { Document, model, Schema } from 'mongoose';
import { DASHBOARD_STATUSES } from './dashboard.schema';

const dashboardSchema = new Schema(
  {
    domain: { type: String, trim: true, lowercase: true, default: '' },
    status: { type: String, required: true, enum: DASHBOARD_STATUSES, default: 'disabled' },
    lastError: { type: String },
    certificateIssuer: { type: String },
    certificateExpiresAt: { type: Date },
    appliedAt: { type: Date },
  },
  {
    versionKey: false,
    timestamps: true,
  },
);

export default model<Dashboard & Document>('dashboards', dashboardSchema);
