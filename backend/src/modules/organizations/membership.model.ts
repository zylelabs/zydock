import { Document, model, Schema } from 'mongoose';
import { paginateStatics } from '../../utils/pagination';
import { ORGANIZATION_ROLES } from './membership.schema';

const membershipSchema = new Schema(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'organizations',
      required: true,
      index: true,
    },
    userId: { type: Schema.Types.ObjectId, ref: 'users', required: true, index: true },
    role: { type: String, required: true, enum: ORGANIZATION_ROLES },
  },
  {
    versionKey: false,
    timestamps: true,
    statics: paginateStatics,
  },
);

membershipSchema.index({ organizationId: 1, userId: 1 }, { unique: true });

export default model('memberships', membershipSchema) as unknown as PaginateModel<
  Membership & Document
>;
