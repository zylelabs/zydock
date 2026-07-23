import type { Context } from 'hono';
import { createRouter, validator } from 'hono-route-docs';
import { paginationQuery } from '../../utils/pagination';
import { authMiddleware } from '../auth/auth.middleware';
import { OrganizationIdParam, organizationIdParamSchema } from '../organizations/membership.schema';
import { createOrganizationRoleGuard } from '../organizations/organizations.middleware';
import notificationChannelModel from './notification-channel.model';
import notificationModel from './notification.model';
import {
  addressIssue,
  CreateNotificationChannelDTO,
  createNotificationChannelSchema,
  ListNotificationChannelsQuery,
  listNotificationChannelsQuerySchema,
  ListNotificationsQuery,
  listNotificationsQuerySchema,
  NotificationChannelIdParam,
  notificationChannelIdParamSchema,
  UpdateNotificationChannelDTO,
  updateNotificationChannelSchema,
} from './notification.schema';
import {
  createNotificationChannel,
  findNotificationChannel,
  removeNotificationChannel,
  serializeNotification,
  serializeNotificationChannel,
  testNotificationChannel,
  updateNotificationChannel,
} from './notification.service';
import { notificationsDocs } from './notifications.docs';

const { router, get, post, patch, delete: del } = createRouter();

get(
  '/channels',
  notificationsDocs.listChannels,
  authMiddleware,
  validator('param', organizationIdParamSchema),
  createOrganizationRoleGuard('member'),
  validator('query', listNotificationChannelsQuerySchema),
  async (c: Context) => {
    const { organizationId } = c.req.valid('param' as never) as OrganizationIdParam;
    const { channel, enabled } = c.req.valid('query' as never) as ListNotificationChannelsQuery;
    const { page, size, sort, order } = paginationQuery(c);

    const result = await notificationChannelModel.paginate(
      {
        organizationId,
        ...(channel ? { channel } : {}),
        ...(enabled === undefined ? {} : { enabled }),
      },
      { page, size, sort, order },
    );

    return c.json({ ...result, items: result.items.map(serializeNotificationChannel) });
  },
);

post(
  '/channels',
  notificationsDocs.createChannel,
  authMiddleware,
  validator('param', organizationIdParamSchema),
  createOrganizationRoleGuard('admin'),
  validator('json', createNotificationChannelSchema),
  async (c: Context) => {
    const { organizationId } = c.req.valid('param' as never) as OrganizationIdParam;
    const body = c.req.valid('json' as never) as CreateNotificationChannelDTO;

    const channel = await createNotificationChannel(organizationId, body);

    return c.json({ channel: serializeNotificationChannel(channel) }, 201);
  },
);

get(
  '/channels/:channelId',
  notificationsDocs.getChannel,
  authMiddleware,
  validator('param', notificationChannelIdParamSchema),
  createOrganizationRoleGuard('member'),
  async (c: Context) => {
    const { organizationId, channelId } = c.req.valid(
      'param' as never,
    ) as NotificationChannelIdParam;

    const channel = await findNotificationChannel(organizationId, channelId);

    if (!channel) {
      return c.json({ error: 'Notification channel not found' }, 404);
    }

    return c.json({ channel: serializeNotificationChannel(channel) });
  },
);

patch(
  '/channels/:channelId',
  notificationsDocs.updateChannel,
  authMiddleware,
  validator('param', notificationChannelIdParamSchema),
  createOrganizationRoleGuard('admin'),
  validator('json', updateNotificationChannelSchema),
  async (c: Context) => {
    const { organizationId, channelId } = c.req.valid(
      'param' as never,
    ) as NotificationChannelIdParam;
    const body = c.req.valid('json' as never) as UpdateNotificationChannelDTO;

    const channel = await findNotificationChannel(organizationId, channelId);

    if (!channel) {
      return c.json({ error: 'Notification channel not found' }, 404);
    }

    // The address is validated against the stored kind, which the body cannot change.
    const issue = body.address ? addressIssue(channel.channel, body.address) : undefined;

    if (issue) {
      return c.json({ error: issue }, 400);
    }

    if (body.secret && channel.channel === 'email') {
      return c.json({ error: 'Only a webhook channel accepts a secret' }, 400);
    }

    const updated = await updateNotificationChannel(channel, body);

    return c.json({ channel: serializeNotificationChannel(updated!) });
  },
);

post(
  '/channels/:channelId/test',
  notificationsDocs.testChannel,
  authMiddleware,
  validator('param', notificationChannelIdParamSchema),
  createOrganizationRoleGuard('admin'),
  async (c: Context) => {
    const { organizationId, channelId } = c.req.valid(
      'param' as never,
    ) as NotificationChannelIdParam;

    const channel = await findNotificationChannel(organizationId, channelId);

    if (!channel) {
      return c.json({ error: 'Notification channel not found' }, 404);
    }

    return c.json(await testNotificationChannel(channel));
  },
);

del(
  '/channels/:channelId',
  notificationsDocs.removeChannel,
  authMiddleware,
  validator('param', notificationChannelIdParamSchema),
  createOrganizationRoleGuard('admin'),
  async (c: Context) => {
    const { organizationId, channelId } = c.req.valid(
      'param' as never,
    ) as NotificationChannelIdParam;

    const channel = await findNotificationChannel(organizationId, channelId);

    if (!channel) {
      return c.json({ error: 'Notification channel not found' }, 404);
    }

    await removeNotificationChannel(channel);

    return c.json({ message: 'Notification channel removed successfully' });
  },
);

get(
  '/',
  notificationsDocs.listNotifications,
  authMiddleware,
  validator('param', organizationIdParamSchema),
  createOrganizationRoleGuard('member'),
  validator('query', listNotificationsQuerySchema),
  async (c: Context) => {
    const { organizationId } = c.req.valid('param' as never) as OrganizationIdParam;
    const { channelId, event, status } = c.req.valid('query' as never) as ListNotificationsQuery;
    const { page, size, sort, order } = paginationQuery(c);

    const result = await notificationModel.paginate(
      {
        organizationId,
        ...(channelId ? { channelId } : {}),
        ...(event ? { event } : {}),
        ...(status ? { status } : {}),
      },
      { page, size, sort, order },
    );

    return c.json({ ...result, items: result.items.map(serializeNotification) });
  },
);

export default router;
