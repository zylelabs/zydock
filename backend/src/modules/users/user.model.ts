import { Document, model, Schema } from 'mongoose';
import { paginateStatics } from '../../utils/pagination';

export default model<User & Document>(
  'users',
  new Schema(
    {
      email: { type: String, required: true, unique: true, lowercase: true, trim: true },
      name: { type: String, required: true, trim: true },
      avatar: { type: String },
      status: { type: String, required: true, enum: ['active', 'disabled'], default: 'active' },
      password: { type: String, select: false },
      lastLoginAt: { type: Date },
    },
    {
      collation: { locale: 'en', strength: 2 },
      versionKey: false,
      timestamps: true,
      statics: paginateStatics,
    },
  ),
) as PaginateModel<User & Document>;
