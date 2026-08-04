<script setup lang="ts">
  import { z } from 'zod';
  import { useApplications, type Application } from '~/composables/services/useApplications';
  import {
    BACKUP_TYPES,
    useBackups,
    type Backup,
    type BackupStatus,
    type BackupType,
    type CreateBackupBody,
  } from '~/composables/services/useBackups';
  import { useDatabases, type Database } from '~/composables/services/useDatabases';
  import { useOrganizations } from '~/composables/services/useOrganizations';
  import { useServers, type Server } from '~/composables/services/useServers';
  import { formatBytes, formatDuration } from '~/utils';

  useHead({ title: 'Backups' });

  const toast = useToast();
  const session = useSessionStore();
  const { current } = useOrganizations();

  const backupsApi = useBackups();
  const databasesApi = useDatabases();
  const serversApi = useServers();
  const applicationsApi = useApplications();

  const canManage = computed(() => ['owner', 'admin'].includes(current.value?.role ?? ''));

  const notifyError = (error: unknown, fallback: string) => {
    toast.error({
      title: 'Error',
      message: (error as { message?: string }).message || fallback,
    });
  };

  const empty = {
    backups: [] as Backup[],
    databases: [] as Database[],
    servers: [] as Server[],
    applications: [] as Application[],
  };

  const load = async () => {
    const [backups, databases, servers, applications] = await Promise.all([
      backupsApi.list(),
      databasesApi.list(),
      serversApi.list(),
      applicationsApi.list(),
    ]);

    return {
      backups: backups.items,
      databases: databases.items,
      servers: servers.items,
      applications: applications.items,
    };
  };

  const { data, refresh, status } = await useAsyncData(
    'backups',
    () => (session.organizationId ? load() : Promise.resolve(empty)),
    { server: false, watch: [() => session.organizationId], default: () => empty },
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

  const STATUS: Record<BackupStatus, { label: string; color: string }> = {
    running: { label: 'Running', color: 'blue' },
    completed: { label: 'Completed', color: 'green' },
    failed: { label: 'Failed', color: 'red' },
  };

  const typeOptions = BACKUP_TYPES.map(type => ({ value: type, label: TYPE_LABELS[type] }));

  const VOLUME_NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

  const adding = ref(false);

  const schema = z
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
    });

  const form = useSchemaForm(
    schema,
    {
      type: 'database' as BackupType,
      databaseId: '',
      serverId: '',
      volumeName: '',
      applicationId: '',
    },
    {
      onError: message => toast.error({ title: 'Error', message }),
      onInvalid: (_errors, lastError) => toast.error({ title: 'Error', message: lastError }),
    },
  );

  const openAdd = () => {
    form.reset();
    form.values.databaseId = databaseOptions.value[0]?.value ?? '';
    form.values.serverId = serverOptions.value[0]?.value ?? '';
    adding.value = true;
  };

  const handleCreate = form.submit(async values => {
    const body: CreateBackupBody =
      values.type === 'database'
        ? { type: 'database', databaseId: values.databaseId }
        : values.type === 'volume'
          ? {
              type: 'volume',
              serverId: values.serverId,
              volumeName: values.volumeName,
              applicationId: values.applicationId || undefined,
            }
          : { type: 'configuration' };

    await backupsApi.create(body);
    adding.value = false;
    await refresh();
  });

  const busy = ref('');

  const handleDownload = async (backup: Backup) => {
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
      notifyError(error, 'Failed to download the backup.');
    } finally {
      busy.value = '';
    }
  };

  const handleRestore = async (backup: Backup) => {
    busy.value = `${backup.id}:restore`;

    try {
      await backupsApi.restore(backup.id);
      await refresh();
    } catch (error) {
      notifyError(error, 'Failed to start the restore.');
    } finally {
      busy.value = '';
    }
  };

  const toRemove = ref<Backup | null>(null);
  const confirmRemoveOpen = ref(false);
  const removing = ref(false);

  const openRemove = (backup: Backup) => {
    toRemove.value = backup;
    confirmRemoveOpen.value = true;
  };

  const handleRemove = async () => {
    if (!toRemove.value) {
      return;
    }

    removing.value = true;

    try {
      await backupsApi.remove(toRemove.value.id);
      await refresh();
      confirmRemoveOpen.value = false;
      toRemove.value = null;
    } catch (error) {
      notifyError(error, 'Failed to remove the backup.');
    } finally {
      removing.value = false;
    }
  };
</script>

<template>
  <Content>
    <Header title="Backups" description="Databases, volumes and configuration exports.">
      <template #right>
        <Button
          v-if="current && canManage && !adding"
          theme="primary"
          class="my-auto"
          @click="openAdd"
        >
          <Icon name="proicons:add" size="18" />
          New backup
        </Button>
      </template>
    </Header>

    <Card v-if="!current" title="Select an organization">
      <p class="text-sm text-content-muted">
        Choose or create an organization in the sidebar selector to manage backups.
      </p>
    </Card>

    <div v-else class="flex flex-col gap-6">
      <Card v-if="adding" title="New backup">
        <form class="flex flex-col gap-4" @submit.prevent="handleCreate">
          <Select v-model="form.values.type" label="Type" :options="typeOptions" />

          <div v-if="form.values.type === 'database'" class="grid gap-4 sm:grid-cols-2">
            <Select v-model="form.values.databaseId" label="Database" :options="databaseOptions" />
          </div>

          <div v-else-if="form.values.type === 'volume'" class="grid gap-4 sm:grid-cols-2">
            <Select v-model="form.values.serverId" label="Server" :options="serverOptions" />
            <Input
              v-model="form.values.volumeName"
              label="Volume name"
              placeholder="zydock-my-app-data"
              :call-error="form.errors.value.volumeName"
            />
            <Select
              v-model="form.values.applicationId"
              label="Application (optional)"
              :options="applicationOptions"
            />
          </div>

          <p v-else class="text-sm text-content-muted">
            Exports the organization's configuration — no application data.
          </p>

          <Alert v-if="form.values.type === 'database' && !databaseOptions.length" theme="warning">
            No databases available.
          </Alert>
          <Alert v-if="form.values.type === 'volume' && !serverOptions.length" theme="warning">
            No servers available.
          </Alert>

          <div class="flex justify-end gap-2">
            <Button theme="ghost" type="button" @click="adding = false">Cancel</Button>
            <Button
              theme="primary"
              type="submit"
              :disabled="
                form.loading.value ||
                (form.values.type === 'database' && !databaseOptions.length) ||
                (form.values.type === 'volume' && !serverOptions.length)
              "
            >
              <Icon v-if="form.loading.value" name="svg-spinners:tadpole" size="16" />
              Start backup
            </Button>
          </div>
        </form>
      </Card>

      <Card v-if="status === 'pending'" title="Backups">
        <p class="text-sm text-content-muted">Loading…</p>
      </Card>

      <div
        v-else-if="!backups.length"
        class="flex flex-col items-center gap-3 rounded-xl border border-dashed border-field-border bg-surface-sunken px-6 py-12 text-center"
      >
        <Icon name="lucide:archive" class="size-8 text-content-dim" />
        <div>
          <h3 class="text-content-strong">No backups yet</h3>
          <p class="mt-1 text-sm text-content-muted">
            Create a backup of a database, volume or the configuration.
          </p>
        </div>
      </div>

      <div v-else class="flex flex-col gap-3">
        <div
          v-for="backup in backups"
          :key="backup.id"
          class="flex flex-wrap items-center gap-4 rounded-xl border border-surface-border bg-surface-raised p-4 shadow-soft backdrop-blur-sm"
        >
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <h3 class="truncate text-content-strong">{{ backup.label }}</h3>
              <Tag>{{ TYPE_LABELS[backup.type] }}</Tag>
              <Tag :color="STATUS[backup.status].color">{{ STATUS[backup.status].label }}</Tag>
              <Tag v-if="backup.restoreStatus === 'running'" color="yellow">Restoring</Tag>
            </div>
            <p class="mt-1 truncate text-xs text-content-muted">
              {{ formatBytes(backup.sizeBytes) }} · {{ formatDuration(backup.durationMs) }}
            </p>
            <p v-if="backup.error" class="mt-1 truncate text-xs text-danger">{{ backup.error }}</p>
            <p v-if="backup.restoreError" class="mt-1 truncate text-xs text-danger">
              Restore failed: {{ backup.restoreError }}
            </p>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <Button
              v-if="backup.status === 'completed'"
              theme="ghost"
              :disabled="busy === `${backup.id}:download`"
              @click="handleDownload(backup)"
            >
              <Icon v-if="busy === `${backup.id}:download`" name="svg-spinners:tadpole" size="16" />
              Download
            </Button>
            <Button
              v-if="canManage && backup.status === 'completed' && backup.type !== 'configuration'"
              theme="secondary"
              :disabled="backup.restoreStatus === 'running' || busy === `${backup.id}:restore`"
              @click="handleRestore(backup)"
            >
              <Icon v-if="busy === `${backup.id}:restore`" name="svg-spinners:tadpole" size="16" />
              Restore
            </Button>
            <button
              v-if="canManage"
              type="button"
              title="Remove backup"
              class="cursor-pointer rounded-lg p-2 text-content-muted transition-colors hover:bg-surface-hover hover:text-danger"
              @click="openRemove(backup)"
            >
              <Icon name="lucide:trash-2" class="size-4" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <Confirm
      v-model:open="confirmRemoveOpen"
      title="Remove backup"
      :message="`Remove “${toRemove?.label}”? This cannot be undone.`"
      confirm-label="Remove"
      danger
      :loading="removing"
      @confirm="handleRemove"
    />
  </Content>
</template>
