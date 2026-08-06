import { Document, model, Schema } from 'mongoose';
import { paginateStatics } from '../../utils/pagination';
import {
  DEPLOYMENT_STATUSES,
  DEPLOYMENT_STEP_STATUSES,
  DEPLOYMENT_STEPS,
  DEPLOYMENT_TRIGGERS,
} from './deployment.schema';

const stepSchema = new Schema(
  {
    step: { type: String, required: true, enum: DEPLOYMENT_STEPS },
    status: { type: String, required: true, enum: DEPLOYMENT_STEP_STATUSES },
    detail: { type: String },
    durationMs: { type: Number, required: true, default: 0 },
  },
  { _id: false },
);

const deploymentSchema = new Schema(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'organizations',
      required: true,
      index: true,
    },
    applicationId: {
      type: Schema.Types.ObjectId,
      ref: 'applications',
      required: true,
      index: true,
    },
    serverId: { type: Schema.Types.ObjectId, ref: 'servers', required: true },
    status: { type: String, required: true, enum: DEPLOYMENT_STATUSES, default: 'queued' },
    trigger: { type: String, required: true, enum: DEPLOYMENT_TRIGGERS },
    triggeredBy: { type: Schema.Types.ObjectId, ref: 'users' },
    branch: { type: String, required: true, trim: true },
    commit: {
      sha: { type: String, trim: true },
      message: { type: String, trim: true },
      author: { type: String, trim: true },
      committedAt: { type: Date },
    },
    imageTag: { type: String, trim: true },
    containerId: { type: String, trim: true },
    steps: { type: [stepSchema], default: [] },
    log: { type: [String], default: [] },
    startedAt: { type: Date },
    finishedAt: { type: Date },
    durationMs: { type: Number },
    error: { type: String },
  },
  {
    versionKey: false,
    timestamps: true,
    statics: paginateStatics,
  },
);

deploymentSchema.index({ applicationId: 1, createdAt: -1 });

export default model('deployments', deploymentSchema) as unknown as PaginateModel<
  Deployment & Document
>;
