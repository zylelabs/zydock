<script setup lang="ts">
  import { z } from 'zod';
  import {
    BACKUP_TYPES,
    type Backup,
    type BackupStatus,
    type BackupType,
  } from '~/composables/use-backups';

  useHead({ title: 'Backups' });

  const session = useSessionStore();
  const { current } = useOrganizations();
  const backupsApi = useBackups();
  const servers = useServers();
  const databases = useDatabases();
  const applications = useApplications();

  const canManage = computed(() => ['owner', 'admin'].includes(current.value?.role ?? ''));
  const actionError = ref('');
  const busy = ref('');

  const { data, refresh } = await useAsyncData(
    'backups',
    async () => {
      if (!session.organizationId) {
        return { backups: [], servers: [], databases: [], applications: [] };
      }

      const [backupList, serverList, databaseList, applicationList] = await Promise.all([
        backupsApi.list(),
        servers.list(),
        databases.list(),
        applications.list(),
      ]);

      return {
        backups: backupList.items,
        servers: serverList.items,
        databases: databaseList.items,
        applications: applicationList.items,
      };
    },
    {
      server: false,
      watch: [() => session.organizationId],
      default: () => ({ backups: [], servers: [], databases: [], applications: [] }),
    },
  );

  const backups = computed(() => data.value?.backups ?? []);
  const databaseOptions = computed(() =>
    (data.value?.databases ?? []).map(database => ({ value: database.id, label: database.name })),
  );
  const serverOptions = computed(() =>
    (data.value?.servers ?? []).map(server => ({ value: server.id, label: server.name })),
  );
  const applicationOptions = computed(() => [
    { value: '', label: 'None' },
    ...(data.value?.applications ?? []).map(application => ({
      value: application.id,
      label: application.name,
    })),
  ]);

  const TYPE_LABELS: Record<BackupType, string> = {
    database: 'Database',
    volume: 'Volume',
    configuration: 'Configuration',
  };

  const STATUS: Record<
    BackupStatus,
    { label: string; variant: 'neutral' | 'success' | 'warning' | 'danger' | 'info' }
  > = {
    running: { label: 'Running', variant: 'info' },
    completed: { label: 'Completed', variant: 'success' },
    failed: { label: 'Failed', variant: 'danger' },
  };

  const typeOptions = BACKUP_TYPES.map(type => ({ value: type, label: TYPE_LABELS[type] }));

  const VOLUME_NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

  const adding = ref(false);

  const form = useForm(
    z
      .object({
        type: z.enum(BACKUP_TYPES),
        databaseId: z.string(),
        serverId: z.string(),
        volumeName: z.string().trim(),
        applicationId: z.string(),
      })
      .superRefine((value, ctx) => {
        if (value.type === 'database' && !value.databaseId) {
          ctx.addIssue({ code: 'custom', path: ['databaseId'], message: 'Choose a database' });
        }

        if (value.type === 'volume') {
          if (!value.serverId) {
            ctx.addIssue({ code: 'custom', path: ['serverId'], message: 'Choose a server' });
          }

          if (!value.volumeName) {
            ctx.addIssue({ code: 'custom', path: ['volumeName'], message: 'Enter a volume name' });
          } else if (!VOLUME_NAME_REGEX.test(value.volumeName)) {
            ctx.addIssue({ code: 'custom', path: ['volumeName'], message: 'Invalid volume name' });
          }
        }
      }),
    {
      type: 'database' as BackupType,
      databaseId: '',
      serverId: '',
      volumeName: '',
      applicationId: '',
    },
  );

  const openAdd = () => {
    form.reset();
    form.values.databaseId = databaseOptions.value[0]?.value ?? '';
    form.values.serverId = serverOptions.value[0]?.value ?? '';
    adding.value = true;
  };

  const onCreate = form.submit(async values => {
    const body =
      values.type === 'database'
        ? ({ type: 'database', databaseId: values.databaseId } as const)
        : values.type === 'volume'
          ? ({
              type: 'volume',
              serverId: values.serverId,
              volumeName: values.volumeName,
              applicationId: values.applicationId || undefined,
            } as const)
          : ({ type: 'configuration' } as const);

    await backupsApi.create(body);
    adding.value = false;
    await refresh();
  });

  const onDownload = async (backup: Backup) => {
    actionError.value = '';
    busy.value = `${backup.id}:download`;

    try {
      const blob = await backupsApi.download(backup.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');

      anchor.href = url;
      anchor.download = backup.fileName;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      actionError.value =
        (error as { message?: string }).message || 'Failed to download the backup.';
    } finally {
      busy.value = '';
    }
  };

  const onRestore = async (backup: Backup) => {
    actionError.value = '';
    busy.value = `${backup.id}:restore`;

    try {
      await backupsApi.restore(backup.id);
      await refresh();
    } catch (error) {
      actionError.value = (error as { message?: string }).message || 'Failed to start the restore.';
    } finally {
      busy.value = '';
    }
  };

  const toRemove = ref<Backup | null>(null);
  const removing = ref(false);

  const confirmRemove = async () => {
    if (!toRemove.value) {
      return;
    }

    removing.value = true;
    actionError.value = '';

    try {
      await backupsApi.remove(toRemove.value.id);
      toRemove.value = null;
      await refresh();
    } catch (error) {
      actionError.value = (error as { message?: string }).message || 'Failed to remove the backup.';
    } finally {
      removing.value = false;
    }
  };
</script>

<template>
  <section class="mx-auto flex max-w-4xl flex-col gap-6">
    <header class="flex items-center justify-between gap-4">
      <div>
        <h1>Backups</h1>
        <p class="mt-1 text-sm text-content-muted">Databases, volumes and configuration exports.</p>
      </div>
      <UiButton v-if="current && canManage && !adding" @click="openAdd">
        <Icon name="lucide:plus" class="size-4" />
        New backup
      </UiButton>
    </header>

    <UiAlert v-if="actionError" variant="error">{{ actionError }}</UiAlert>

    <UiCard v-if="!current" title="Select an organization">
      <p class="text-sm text-content-muted">Choose or create an organization in the sidebar.</p>
    </UiCard>

    <template v-else>
      <UiCard v-if="adding" title="New backup">
        <form class="flex flex-col gap-4" @submit.prevent="onCreate">
          <UiAlert v-if="form.formError.value" variant="error">{{ form.formError.value }}</UiAlert>

          <UiSelect v-model="form.values.type" label="Type" :options="typeOptions" />

          <div v-if="form.values.type === 'database'" class="grid gap-4 sm:grid-cols-2">
            <UiSelect
              v-model="form.values.databaseId"
              label="Database"
              :options="databaseOptions"
              :error="form.errors.value.databaseId"
            />
          </div>

          <div v-else-if="form.values.type === 'volume'" class="grid gap-4 sm:grid-cols-2">
            <UiSelect
              v-model="form.values.serverId"
              label="Server"
              :options="serverOptions"
              :error="form.errors.value.serverId"
            />
            <UiInput
              v-model="form.values.volumeName"
              label="Volume name"
              placeholder="zydock-my-app-data"
              :error="form.errors.value.volumeName"
            />
            <UiSelect
              v-model="form.values.applicationId"
              label="Application (optional)"
              :options="applicationOptions"
            />
          </div>

          <p v-else class="text-sm text-content-muted">
            Exports the organization's configuration — no application data.
          </p>

          <p
            v-if="form.values.type === 'database' && !databaseOptions.length"
            class="text-xs text-warning"
          >
            No databases available.
          </p>
          <p
            v-if="form.values.type === 'volume' && !serverOptions.length"
            class="text-xs text-warning"
          >
            No servers available.
          </p>

          <div class="flex justify-end gap-2">
            <UiButton variant="ghost" type="button" @click="adding = false">Cancel</UiButton>
            <UiButton
              type="submit"
              :loading="form.submitting.value"
              :disabled="
                (form.values.type === 'database' && !databaseOptions.length) ||
                (form.values.type === 'volume' && !serverOptions.length)
              "
            >
              Start backup
            </UiButton>
          </div>
        </form>
      </UiCard>

      <UiCard v-if="!backups.length" title="No backups yet">
        <p class="text-sm text-content-muted">
          Create a backup of a database, volume or the configuration.
        </p>
      </UiCard>

      <div v-else class="flex flex-col gap-3">
        <div
          v-for="backup in backups"
          :key="backup.id"
          class="flex flex-wrap items-center gap-4 rounded-xl border border-surface-border bg-surface-raised p-4"
        >
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <h3 class="truncate">{{ backup.label }}</h3>
              <UiBadge variant="info">{{ TYPE_LABELS[backup.type] }}</UiBadge>
              <UiBadge :variant="STATUS[backup.status].variant">
                {{ STATUS[backup.status].label }}
              </UiBadge>
              <UiBadge v-if="backup.restoreStatus === 'running'" variant="warning"
                >Restoring</UiBadge
              >
            </div>
            <p class="mt-1 truncate text-xs text-content-muted">
              {{ formatBytes(backup.sizeBytes) }} · {{ formatDuration(backup.durationMs) }}
            </p>
            <p v-if="backup.error" class="mt-1 truncate text-xs text-danger">{{ backup.error }}</p>
            <p v-if="backup.restoreError" class="mt-1 truncate text-xs text-danger">
              Restore failed: {{ backup.restoreError }}
            </p>
          </div>

          <div v-if="canManage" class="flex flex-wrap items-center gap-2">
            <UiButton
              v-if="backup.status === 'completed'"
              variant="ghost"
              :loading="busy === `${backup.id}:download`"
              @click="onDownload(backup)"
            >
              Download
            </UiButton>
            <UiButton
              v-if="backup.status === 'completed' && backup.type !== 'configuration'"
              variant="secondary"
              :disabled="backup.restoreStatus === 'running'"
              :loading="busy === `${backup.id}:restore`"
              @click="onRestore(backup)"
            >
              Restore
            </UiButton>
            <button
              type="button"
              title="Remove"
              class="rounded-lg p-2 text-content-muted transition-colors hover:text-danger"
              @click="toRemove = backup"
            >
              <Icon name="lucide:trash-2" class="size-4" />
            </button>
          </div>
        </div>
      </div>
    </template>

    <UiConfirm
      :open="Boolean(toRemove)"
      title="Remove backup"
      :message="`Remove “${toRemove?.label}”? This cannot be undone.`"
      confirm-label="Remove"
      danger
      :loading="removing"
      @confirm="confirmRemove"
      @update:open="value => !value && (toRemove = null)"
    />
  </section>
</template>
