import { Document, model, Schema } from 'mongoose';
import { NOTIFICATION_CHANNELS } from '../../providers/notification/notification.contract';
import { paginateStatics } from '../../utils/pagination';
import { NOTIFICATION_EVENTS } from './notification.schema';

const notificationChannelSchema = new Schema(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'organizations',
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    channel: { type: String, required: true, enum: NOTIFICATION_CHANNELS },
    address: { type: String, required: true, trim: true },
    secret: { type: String, select: false },
    hasSecret: { type: Boolean, required: true, default: false },
    events: { type: [String], required: true, enum: NOTIFICATION_EVENTS },
    enabled: { type: Boolean, required: true, default: true },
    lastDeliveryAt: { type: Date },
    lastError: { type: String },
  },
  {
    versionKey: false,
    timestamps: true,
    statics: paginateStatics,
  },
);

notificationChannelSchema.index({ organizationId: 1, enabled: 1, events: 1 });

export default model(
  'notification_channels',
  notificationChannelSchema,
) as unknown as PaginateModel<NotificationChannel & Document>;
