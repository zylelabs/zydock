import { Document, model, Schema } from 'mongoose';
import { paginateStatics } from '../../utils/pagination';
import { DOMAIN_STATUSES } from './domain.schema';

const domainSchema = new Schema(
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
    // Denormalized from the application, so configuring the proxy never needs to load it again.
    serverId: { type: Schema.Types.ObjectId, ref: 'servers', required: true },
    hostname: { type: String, required: true, trim: true, lowercase: true },
    pathPrefix: { type: String, trim: true },
    tls: { type: Boolean, required: true, default: true },
    status: { type: String, required: true, enum: DOMAIN_STATUSES, default: 'pending' },
    lastError: { type: String },
  },
  {
    versionKey: false,
    timestamps: true,
    statics: paginateStatics,
  },
);

// A hostname points at one place: it is a public DNS name, unique across the whole platform.
domainSchema.index({ hostname: 1 }, { unique: true });

export default model('domains', domainSchema) as unknown as PaginateModel<Domain & Document>;
