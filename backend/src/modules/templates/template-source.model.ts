import { Document, model, Schema } from 'mongoose';
import { paginateStatics } from '../../utils/pagination';

const templateSourceSchema = new Schema(
  {
    url: { type: String, required: true, trim: true },
    ref: { type: String, required: true, trim: true, default: 'main' },
    enabled: { type: Boolean, required: true, default: true },
    lastSyncedAt: { type: Date },
    lastError: { type: String },
    templateCount: { type: Number, required: true, default: 0 },
  },
  {
    versionKey: false,
    timestamps: true,
    statics: paginateStatics,
  },
);

export default model('template_sources', templateSourceSchema) as unknown as PaginateModel<
  TemplateSource & Document
>;
