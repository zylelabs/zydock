<script setup lang="ts">
  import { z } from 'zod';
  import {
    NOTIFICATION_CHANNELS,
    NOTIFICATION_EVENTS,
    type NotificationChannel,
    type NotificationChannelKind,
    type NotificationEvent,
    type NotificationStatus,
  } from '~/composables/use-notifications';

  useHead({ title: 'Notifications' });

  const session = useSessionStore();
  const { current } = useOrganizations();
  const notificationsApi = useNotifications();

  const canManage = computed(() => ['owner', 'admin'].includes(current.value?.role ?? ''));
  const actionError = ref('');
  const busy = ref('');

  const { data, refresh } = await useAsyncData(
    'notifications',
    async () => {
      if (!session.organizationId) {
        return { channels: [], history: [] };
      }

      const [channelList, notificationList] = await Promise.all([
        notificationsApi.listChannels(),
        notificationsApi.listNotifications(),
      ]);

      return { channels: channelList.items, history: notificationList.items };
    },
    {
      server: false,
      watch: [() => session.organizationId],
      default: () => ({ channels: [], history: [] }),
    },
  );

  const channels = computed(() => data.value?.channels ?? []);
  const history = computed(() => data.value?.history ?? []);
  const channelName = (channelId: string) =>
    channels.value.find(channel => channel.id === channelId)?.name ?? channelId;

  const CHANNEL_LABELS: Record<NotificationChannelKind, string> = {
    email: 'Email',
    webhook: 'Webhook',
  };

  const EVENT_LABELS: Record<NotificationEvent, string> = {
    'deployment.started': 'Deployment started',
    'deployment.succeeded': 'Deployment succeeded',
    'deployment.failed': 'Deployment failed',
  };

  const STATUS: Record<
    NotificationStatus,
    { label: string; variant: 'neutral' | 'success' | 'warning' | 'danger' | 'info' }
  > = {
    pending: { label: 'Pending', variant: 'info' },
    sent: { label: 'Sent', variant: 'success' },
    failed: { label: 'Failed', variant: 'danger' },
  };

  const channelOptions = NOTIFICATION_CHANNELS.map(channel => ({
    value: channel,
    label: CHANNEL_LABELS[channel],
  }));

  const addingChannel = ref(false);

  const channelForm = useForm(
    z
      .object({
        name: z.string().trim().min(1, 'Enter a name').max(80),
        channel: z.enum(NOTIFICATION_CHANNELS),
        address: z.string().trim().min(1, 'Enter an address').max(500),
        secret: z.string().trim().max(200),
        events: z.array(z.enum(NOTIFICATION_EVENTS)).min(1, 'Choose at least one event'),
        enabled: z.boolean(),
      })
      .superRefine((value, ctx) => {
        if (value.channel === 'email') {
          if (!z.email().safeParse(value.address).success) {
            ctx.addIssue({
              code: 'custom',
              path: ['address'],
              message: 'The address must be an e-mail',
            });
          }

          if (value.secret) {
            ctx.addIssue({
              code: 'custom',
              path: ['secret'],
              message: 'Only a webhook channel accepts a secret',
            });
          }

          return;
        }

        const isUrl =
          z.url().safeParse(value.address).success && /^https?:\/\//i.test(value.address);

        if (!isUrl) {
          ctx.addIssue({
            code: 'custom',
            path: ['address'],
            message: 'The address must be an http or https URL',
          });
        }

        if (value.secret && value.secret.length < 8) {
          ctx.addIssue({ code: 'custom', path: ['secret'], message: 'At least 8 characters' });
        }
      }),
    {
      name: '',
      channel: 'email' as NotificationChannelKind,
      address: '',
      secret: '',
      events: [...NOTIFICATION_EVENTS],
      enabled: true,
    },
  );

  const addressLabel = computed(() =>
    channelForm.values.channel === 'email' ? 'Email address' : 'Webhook URL',
  );
  const addressPlaceholder = computed(() =>
    channelForm.values.channel === 'email'
      ? 'ops@company.com'
      : 'https://example.com/webhooks/zydock',
  );

  const eventModel = (event: NotificationEvent) =>
    computed<boolean>({
      get: () => channelForm.values.events.includes(event),
      set: checked => {
        const events = channelForm.values.events;
        const index = events.indexOf(event);

        if (checked && index === -1) {
          events.push(event);
        } else if (!checked && index !== -1) {
          events.splice(index, 1);
        }
      },
    });

  const openAddChannel = () => {
    channelForm.reset();
    addingChannel.value = true;
  };

  const onCreateChannel = channelForm.submit(async values => {
    await notificationsApi.createChannel({
      name: values.name,
      channel: values.channel,
      address: values.address,
      secret: values.channel === 'webhook' ? values.secret || undefined : undefined,
      events: values.events,
      enabled: values.enabled,
    });

    addingChannel.value = false;
    await refresh();
  });

  const testResult = ref<{ channelId: string; delivered: boolean; error?: string } | null>(null);

  const runTest = async (channel: NotificationChannel) => {
    actionError.value = '';
    testResult.value = null;
    busy.value = `${channel.id}:test`;

    try {
      const result = await notificationsApi.testChannel(channel.id);
      testResult.value = { channelId: channel.id, ...result };
      await refresh();
    } catch (error) {
      actionError.value =
        (error as { message?: string }).message || 'Failed to send the test notification.';
    } finally {
      busy.value = '';
    }
  };

  const toggleEnabled = async (channel: NotificationChannel) => {
    actionError.value = '';
    busy.value = `${channel.id}:toggle`;

    try {
      await notificationsApi.updateChannel(channel.id, { enabled: !channel.enabled });
      await refresh();
    } catch (error) {
      actionError.value =
        (error as { message?: string }).message || 'Failed to update the channel.';
    } finally {
      busy.value = '';
    }
  };

  const toRemove = ref<NotificationChannel | null>(null);
  const removing = ref(false);

  const confirmRemove = async () => {
    if (!toRemove.value) {
      return;
    }

    removing.value = true;
    actionError.value = '';

    try {
      await notificationsApi.removeChannel(toRemove.value.id);
      toRemove.value = null;
      await refresh();
    } catch (error) {
      actionError.value =
        (error as { message?: string }).message || 'Failed to remove the channel.';
    } finally {
      removing.value = false;
    }
  };
</script>

<template>
  <section class="mx-auto flex max-w-4xl flex-col gap-6">
    <header class="flex items-center justify-between gap-4">
      <div>
        <h1>Notifications</h1>
        <p class="mt-1 text-sm text-content-muted">
          Channels and delivery history for deploy events.
        </p>
      </div>
      <UiButton v-if="current && canManage && !addingChannel" @click="openAddChannel">
        <Icon name="lucide:plus" class="size-4" />
        New channel
      </UiButton>
    </header>

    <UiAlert v-if="actionError" variant="error">{{ actionError }}</UiAlert>

    <UiCard v-if="!current" title="Select an organization">
      <p class="text-sm text-content-muted">Choose or create an organization in the sidebar.</p>
    </UiCard>

    <template v-else>
      <UiCard v-if="addingChannel" title="New channel">
        <form class="flex flex-col gap-4" @submit.prevent="onCreateChannel">
          <UiAlert v-if="channelForm.formError.value" variant="error">
            {{ channelForm.formError.value }}
          </UiAlert>

          <div class="grid gap-4 sm:grid-cols-2">
            <UiInput
              v-model="channelForm.values.name"
              label="Name"
              placeholder="on-call e-mail"
              :error="channelForm.errors.value.name"
            />
            <UiSelect v-model="channelForm.values.channel" label="Type" :options="channelOptions" />
            <UiInput
              v-model="channelForm.values.address"
              :label="addressLabel"
              :placeholder="addressPlaceholder"
              :error="channelForm.errors.value.address"
            />
            <UiInput
              v-if="channelForm.values.channel === 'webhook'"
              v-model="channelForm.values.secret"
              label="Signing secret (optional)"
              type="password"
              placeholder="Signs the delivered payload"
              :error="channelForm.errors.value.secret"
            />
          </div>

          <div>
            <p class="mb-2 text-sm font-medium text-content">Events</p>
            <div class="flex flex-col gap-2">
              <UiCheckbox
                v-for="event in NOTIFICATION_EVENTS"
                :key="event"
                v-model="eventModel(event).value"
                :label="EVENT_LABELS[event]"
              />
            </div>
            <p v-if="channelForm.errors.value.events" class="mt-1 text-xs text-danger">
              {{ channelForm.errors.value.events }}
            </p>
          </div>

          <UiCheckbox v-model="channelForm.values.enabled" label="Enabled" />

          <div class="flex justify-end gap-2">
            <UiButton variant="ghost" type="button" @click="addingChannel = false">Cancel</UiButton>
            <UiButton type="submit" :loading="channelForm.submitting.value"
              >Create channel</UiButton
            >
          </div>
        </form>
      </UiCard>

      <UiCard title="Channels">
        <p v-if="!channels.length" class="text-sm text-content-muted">
          No notification channels yet.
        </p>

        <div v-else class="flex flex-col gap-3">
          <div
            v-for="channel in channels"
            :key="channel.id"
            class="flex flex-wrap items-center gap-4 rounded-xl border border-surface-border bg-surface-raised p-4"
          >
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <h3 class="truncate">{{ channel.name }}</h3>
                <UiBadge variant="info">{{ CHANNEL_LABELS[channel.channel] }}</UiBadge>
                <UiBadge :variant="channel.enabled ? 'success' : 'neutral'">
                  {{ channel.enabled ? 'Enabled' : 'Disabled' }}
                </UiBadge>
              </div>
              <p class="mt-1 truncate text-xs text-content-muted">{{ channel.address }}</p>
              <p v-if="channel.lastError" class="mt-1 truncate text-xs text-danger">
                {{ channel.lastError }}
              </p>
              <p
                v-if="testResult?.channelId === channel.id"
                class="mt-1 text-xs"
                :class="testResult.delivered ? 'text-success' : 'text-danger'"
              >
                {{
                  testResult.delivered
                    ? 'Test notification delivered.'
                    : testResult.error || 'Test notification failed.'
                }}
              </p>
            </div>

            <div v-if="canManage" class="flex flex-wrap items-center gap-2">
              <UiButton
                variant="ghost"
                :loading="busy === `${channel.id}:test`"
                @click="runTest(channel)"
              >
                Test
              </UiButton>
              <UiButton
                variant="secondary"
                :loading="busy === `${channel.id}:toggle`"
                @click="toggleEnabled(channel)"
              >
                {{ channel.enabled ? 'Disable' : 'Enable' }}
              </UiButton>
              <button
                type="button"
                title="Remove"
                class="rounded-lg p-2 text-content-muted transition-colors hover:text-danger"
                @click="toRemove = channel"
              >
                <Icon name="lucide:trash-2" class="size-4" />
              </button>
            </div>
          </div>
        </div>
      </UiCard>

      <UiCard title="History">
        <p v-if="!history.length" class="text-sm text-content-muted">No notifications sent yet.</p>

        <ul v-else class="flex flex-col divide-y divide-surface-border">
          <li v-for="entry in history" :key="entry.id" class="flex items-center gap-3 py-3">
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium">{{ entry.subject }}</p>
              <p class="truncate text-xs text-content-muted">
                {{ channelName(entry.channelId) }} · {{ EVENT_LABELS[entry.event] }}
              </p>
            </div>
            <UiBadge :variant="STATUS[entry.status].variant">
              {{ STATUS[entry.status].label }}
            </UiBadge>
          </li>
        </ul>
      </UiCard>
    </template>

    <UiConfirm
      :open="Boolean(toRemove)"
      title="Remove channel"
      :message="`Remove “${toRemove?.name}”? It will stop receiving notifications.`"
      confirm-label="Remove"
      danger
      :loading="removing"
      @confirm="confirmRemove"
      @update:open="value => !value && (toRemove = null)"
    />
  </section>
</template>
