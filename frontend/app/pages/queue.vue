<script setup lang="ts">
  import { JOB_STATUSES, type Job, type JobStatus } from '~/composables/use-queue';

  useHead({ title: 'Queue' });

  const session = useSessionStore();
  const isSuperuser = computed(() => Boolean(session.user?.superuser));
  const queueApi = useQueue();

  const actionError = ref('');
  const busy = ref('');

  const statusFilter = ref<JobStatus | ''>('');
  const typeFilter = ref('');

  const { data, refresh } = await useAsyncData(
    'queue',
    async () => {
      if (!isSuperuser.value) {
        return { jobs: [] };
      }

      const result = await queueApi.list({
        status: statusFilter.value || undefined,
        type: typeFilter.value || undefined,
      });

      return { jobs: result.items };
    },
    {
      server: false,
      watch: [isSuperuser, statusFilter, typeFilter],
      default: () => ({ jobs: [] }),
    },
  );

  const jobs = computed(() => data.value?.jobs ?? []);

  const STATUS: Record<
    JobStatus,
    { label: string; variant: 'neutral' | 'success' | 'warning' | 'danger' | 'info' }
  > = {
    pending: { label: 'Pending', variant: 'neutral' },
    running: { label: 'Running', variant: 'info' },
    completed: { label: 'Completed', variant: 'success' },
    failed: { label: 'Failed', variant: 'danger' },
  };

  const statusOptions = [
    { value: '', label: 'All statuses' },
    ...JOB_STATUSES.map(status => ({ value: status, label: STATUS[status].label })),
  ];

  const JOB_TYPE_LABELS: Record<string, string> = {
    'deployment.run': 'Deployment',
    'backup.run': 'Backup',
    'backup.restore': 'Backup restore',
    'notification.deliver': 'Notification',
  };

  const typeOptions = [
    { value: '', label: 'All types' },
    ...Object.entries(JOB_TYPE_LABELS).map(([value, label]) => ({ value, label })),
  ];

  const typeLabel = (type: string) => JOB_TYPE_LABELS[type] ?? type;

  const runRetry = async (job: Job) => {
    actionError.value = '';
    busy.value = `${job.id}:retry`;

    try {
      await queueApi.retry(job.id);
      await refresh();
    } catch (error) {
      actionError.value = (error as { message?: string }).message || 'Failed to retry the job.';
    } finally {
      busy.value = '';
    }
  };

  const toRemove = ref<Job | null>(null);
  const removing = ref(false);

  const confirmRemove = async () => {
    if (!toRemove.value) {
      return;
    }

    removing.value = true;
    actionError.value = '';

    try {
      await queueApi.remove(toRemove.value.id);
      toRemove.value = null;
      await refresh();
    } catch (error) {
      actionError.value = (error as { message?: string }).message || 'Failed to remove the job.';
    } finally {
      removing.value = false;
    }
  };
</script>

<template>
  <section class="mx-auto flex max-w-4xl flex-col gap-6">
    <header>
      <h1>Queue</h1>
      <p class="mt-1 text-sm text-content-muted">
        Background jobs — deploys, backups and notification delivery.
      </p>
    </header>

    <UiAlert v-if="actionError" variant="error">{{ actionError }}</UiAlert>

    <UiCard v-if="!isSuperuser" title="Access restricted">
      <p class="text-sm text-content-muted">Only a superuser account can view the job queue.</p>
    </UiCard>

    <template v-else>
      <div class="flex flex-wrap gap-4">
        <div class="w-48">
          <UiSelect v-model="statusFilter" label="Status" :options="statusOptions" />
        </div>
        <div class="w-56">
          <UiSelect v-model="typeFilter" label="Type" :options="typeOptions" />
        </div>
      </div>

      <UiCard v-if="!jobs.length" title="No jobs">
        <p class="text-sm text-content-muted">No jobs match this filter.</p>
      </UiCard>

      <ul v-else class="flex flex-col divide-y divide-surface-border">
        <li v-for="job in jobs" :key="job.id" class="flex items-center gap-3 py-3">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <p class="truncate text-sm font-medium">{{ typeLabel(job.type) }}</p>
              <UiBadge :variant="STATUS[job.status].variant">
                {{ STATUS[job.status].label }}
              </UiBadge>
            </div>
            <p class="mt-1 truncate text-xs text-content-muted">
              Attempt {{ job.attempts }} of {{ job.maxAttempts }}
            </p>
            <p v-if="job.lastError" class="mt-1 truncate text-xs text-danger">
              {{ job.lastError }}
            </p>
          </div>

          <div class="flex shrink-0 items-center gap-2">
            <UiButton
              v-if="job.status === 'failed'"
              variant="secondary"
              :loading="busy === `${job.id}:retry`"
              @click="runRetry(job)"
            >
              Retry
            </UiButton>
            <button
              type="button"
              title="Remove"
              :disabled="job.status === 'running'"
              class="rounded-lg p-2 text-content-muted transition-colors hover:text-danger disabled:cursor-not-allowed disabled:opacity-40"
              @click="toRemove = job"
            >
              <Icon name="lucide:trash-2" class="size-4" />
            </button>
          </div>
        </li>
      </ul>
    </template>

    <UiConfirm
      :open="Boolean(toRemove)"
      title="Remove job"
      :message="`Remove this ${toRemove ? typeLabel(toRemove.type) : ''} job from the queue?`"
      confirm-label="Remove"
      danger
      :loading="removing"
      @confirm="confirmRemove"
      @update:open="value => !value && (toRemove = null)"
    />
  </section>
</template>
