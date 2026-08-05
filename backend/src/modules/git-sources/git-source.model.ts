import { Document, model, Schema } from 'mongoose';
import { paginateStatics } from '../../utils/pagination';
import { GIT_SOURCE_STATUSES } from './git-source.schema';

const gitSourceSchema = new Schema(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'organizations',
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    status: { type: String, required: true, enum: GIT_SOURCE_STATUSES, default: 'pending' },
    state: { type: String, select: false },
    stateExpiresAt: { type: Date },
    appId: { type: String },
    slug: { type: String },
    htmlUrl: { type: String },
    clientId: { type: String },
    clientSecret: { type: String, select: false },
    webhookSecret: { type: String, select: false },
    privateKey: { type: String, select: false },
    createdBy: { type: Schema.Types.ObjectId, ref: 'users', required: true },
  },
  {
    versionKey: false,
    timestamps: true,
    statics: paginateStatics,
  },
);

export default model('git_sources', gitSourceSchema) as unknown as PaginateModel<
  GitSource & Document
>;
