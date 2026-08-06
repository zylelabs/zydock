import { Document, model, Schema } from 'mongoose';
import { paginateStatics } from '../../utils/pagination';

export default model<Organization & Document>(
  'organizations',
  new Schema(
    {
      name: { type: String, required: true, trim: true },
      slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    },
    {
      versionKey: false,
      timestamps: true,
      statics: paginateStatics,
    },
  ),
) as PaginateModel<Organization & Document>;
