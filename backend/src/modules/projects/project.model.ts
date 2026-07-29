import { Document, model, Schema } from 'mongoose';
import { paginateStatics } from '../../utils/pagination';

const projectSchema = new Schema(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'organizations',
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true, lowercase: true },
    description: { type: String, trim: true },
  },
  {
    versionKey: false,
    timestamps: true,
    statics: paginateStatics,
  },
);

projectSchema.index({ organizationId: 1, slug: 1 }, { unique: true });

export default model('projects', projectSchema) as unknown as PaginateModel<Project & Document>;
