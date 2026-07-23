import { Document, model, Schema } from 'mongoose';
import config from '../../config';
import { NOTIFICATION_SEVERITIES } from '../../providers/notification/notification.contract';
import { paginateStatics } from '../../utils/pagination';
import { NOTIFICATION_EVENTS, NOTIFICATION_STATUSES } from './notification.schema';

const notificationSchema = new Schema(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'organizations',
      required: true,
      index: true,
    },
    channelId: {
      type: Schema.Types.ObjectId,
      ref: 'notification_channels',
      required: true,
      index: true,
    },
    event: { type: String, required: true, enum: NOTIFICATION_EVENTS },
    subject: { type: String, required: true },
    body: { type: String, required: true },
    severity: { type: String, required: true, enum: NOTIFICATION_SEVERITIES },
    metadata: { type: Schema.Types.Mixed, required: true, default: {} },
    status: { type: String, required: true, enum: NOTIFICATION_STATUSES, default: 'pending' },
    sentAt: { type: Date },
    error: { type: String },
  },
  {
    versionKey: false,
    timestamps: true,
    statics: paginateStatics,
  },
);

// A delivery record is history, not state: it expires on its own, the same way metric samples do.
notificationSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: config.notifications.retentionHours * 3600 },
);

// The history is always read as "this organization, most recent first".
notificationSchema.index({ organizationId: 1, createdAt: -1 });

export default model('notifications', notificationSchema) as unknown as PaginateModel<
  Notification & Document
>;
