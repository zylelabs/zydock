import { Document, model, Schema } from 'mongoose';
import { paginateStatics } from '../../utils/pagination';

const environmentSchema = new Schema(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'organizations',
      required: true,
      index: true,
    },
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'projects',
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true, lowercase: true },
  },
  {
    versionKey: false,
    timestamps: true,
    statics: paginateStatics,
  },
);

environmentSchema.index({ projectId: 1, slug: 1 }, { unique: true });

export default model('environments', environmentSchema) as unknown as PaginateModel<
  Environment & Document
>;
