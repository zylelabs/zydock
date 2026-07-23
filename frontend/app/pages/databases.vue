<script setup lang="ts">
  import { z } from 'zod';
  import {
    DATABASE_ENGINES,
    type Database,
    type DatabaseCredentials,
    type DatabaseStatus,
  } from '~/composables/use-databases';

  useHead({ title: 'Databases' });

  const session = useSessionStore();
  const { current } = useOrganizations();
  const databases = useDatabases();
  const servers = useServers();

  const canManage = computed(() => ['owner', 'admin'].includes(current.value?.role ?? ''));
  const actionError = ref('');
  const busy = ref('');

  const { data, refresh } = await useAsyncData(
    'databases',
    async () => {
      if (!session.organizationId) {
        return { databases: [], servers: [] };
      }

      const [databaseList, serverList] = await Promise.all([databases.list(), servers.list()]);

      return { databases: databaseList.items, servers: serverList.items };
    },
    {
      server: false,
      watch: [() => session.organizationId],
      default: () => ({ databases: [], servers: [] }),
    },
  );

  const databaseList = computed(() => data.value?.databases ?? []);
  const serverOptions = computed(() =>
    (data.value?.servers ?? []).map(server => ({ value: server.id, label: server.name })),
  );
  const serverName = (id: string) =>
    (data.value?.servers ?? []).find(server => server.id === id)?.name ?? id;

  const STATUS: Record<
    DatabaseStatus,
    { label: string; variant: 'neutral' | 'success' | 'warning' | 'danger' | 'info' }
  > = {
    provisioning: { label: 'Provisioning', variant: 'info' },
    running: { label: 'Running', variant: 'success' },
    stopped: { label: 'Stopped', variant: 'warning' },
    failed: { label: 'Failed', variant: 'danger' },
    unknown: { label: 'Unknown', variant: 'neutral' },
  };

  const engineOptions = DATABASE_ENGINES.map(engine => ({ value: engine, label: engine }));

  const adding = ref(false);
  const form = useForm(
    z.object({
      name: z.string().trim().min(1, 'Enter a name'),
      serverId: z.string().min(1, 'Choose a server'),
      engine: z.enum(DATABASE_ENGINES),
      version: z.string().trim().optional(),
    }),
    {
      name: '',
      serverId: '',
      engine: 'postgresql' as (typeof DATABASE_ENGINES)[number],
      version: '',
    },
  );

  const openAdd = () => {
    form.reset();
    form.values.serverId = data.value?.servers[0]?.id ?? '';
    adding.value = true;
  };

  const onCreate = form.submit(async values => {
    await databases.create({
      name: values.name,
      serverId: values.serverId,
      engine: values.engine,
      version: values.version || undefined,
    });
    adding.value = false;
    await refresh();
  });

  const runLifecycle = async (database: Database, action: 'start' | 'stop' | 'restart') => {
    actionError.value = '';
    busy.value = `${database.id}:${action}`;

    try {
      await databases.lifecycle(database.id, action);
      await refresh();
    } catch (error) {
      actionError.value = (error as { message?: string }).message || 'The operation failed.';
    } finally {
      busy.value = '';
    }
  };

  // --- Credentials ---
  const credentials = ref<DatabaseCredentials | null>(null);
  const credentialsOpen = ref(false);

  const showCredentials = async (database: Database) => {
    actionError.value = '';
    busy.value = `${database.id}:cred`;

    try {
      credentials.value = (await databases.credentials(database.id)).credentials;
      credentialsOpen.value = true;
    } catch (error) {
      actionError.value = (error as { message?: string }).message || 'Failed to read credentials.';
    } finally {
      busy.value = '';
    }
  };

  // --- Removal ---
  const toRemove = ref<Database | null>(null);
  const removeData = ref(false);
  const removing = ref(false);

  const confirmRemove = async () => {
    if (!toRemove.value) {
      return;
    }

    removing.value = true;
    actionError.value = '';

    try {
      await databases.remove(toRemove.value.id, removeData.value);
      await refresh();
      toRemove.value = null;
      removeData.value = false;
    } catch (error) {
      actionError.value = (error as { message?: string }).message || 'Failed to remove.';
    } finally {
      removing.value = false;
    }
  };
</script>

<template>
  <section class="mx-auto flex max-w-4xl flex-col gap-6">
    <header class="flex items-center justify-between gap-4">
      <div>
        <h1>Databases</h1>
        <p class="mt-1 text-sm text-content-muted">Managed instances on your servers.</p>
      </div>
      <UiButton
        v-if="current && canManage && !adding"
        :disabled="!serverOptions.length"
        @click="openAdd"
      >
        <Icon name="lucide:plus" class="size-4" />
        New database
      </UiButton>
    </header>

    <UiAlert v-if="actionError" variant="error">{{ actionError }}</UiAlert>

    <UiCard v-if="!current" title="Select an organization">
      <p class="text-sm text-content-muted">Choose or create an organization in the sidebar.</p>
    </UiCard>

    <template v-else>
      <UiCard v-if="adding" title="New database">
        <form class="flex flex-col gap-4" @submit.prevent="onCreate">
          <UiAlert v-if="form.formError.value" variant="error">{{ form.formError.value }}</UiAlert>
          <div class="grid gap-4 sm:grid-cols-2">
            <UiInput
              v-model="form.values.name"
              label="Name"
              placeholder="my-database"
              :error="form.errors.value.name"
            />
            <UiSelect
              v-model="form.values.serverId"
              label="Server"
              :options="serverOptions"
              :error="form.errors.value.serverId"
            />
            <UiSelect v-model="form.values.engine" label="Engine" :options="engineOptions" />
            <UiInput
              v-model="form.values.version"
              label="Version (optional)"
              placeholder="16-alpine"
            />
          </div>
          <div class="flex justify-end gap-2">
            <UiButton variant="ghost" type="button" @click="adding = false">Cancel</UiButton>
            <UiButton type="submit" :loading="form.submitting.value">Provision</UiButton>
          </div>
        </form>
      </UiCard>

      <UiCard v-if="!databaseList.length" title="No databases yet">
        <p class="text-sm text-content-muted">Provision a managed database on a server.</p>
      </UiCard>

      <div v-else class="flex flex-col gap-3">
        <div
          v-for="database in databaseList"
          :key="database.id"
          class="flex flex-wrap items-center gap-4 rounded-xl border border-surface-border bg-surface-raised p-4"
        >
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <h3 class="truncate">{{ database.name }}</h3>
              <UiBadge variant="info">{{ database.engine }} {{ database.version }}</UiBadge>
              <UiBadge :variant="STATUS[database.status].variant">
                {{ STATUS[database.status].label }}
              </UiBadge>
            </div>
            <p class="mt-1 truncate text-xs text-content-muted">
              {{ serverName(database.serverId) }} · {{ database.connection.host }}:{{
                database.connection.port
              }}
            </p>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <NuxtLink
              :to="`/databases/${database.id}`"
              class="inline-flex items-center gap-2 rounded-lg border border-surface-border px-3 py-2 text-sm text-content-muted transition-colors hover:text-content"
            >
              <Icon name="lucide:layout-grid" class="size-4" />
              Details
            </NuxtLink>
            <UiButton
              v-if="canManage"
              variant="ghost"
              :loading="busy === `${database.id}:cred`"
              @click="showCredentials(database)"
            >
              Credentials
            </UiButton>
            <UiButton
              v-if="canManage && database.status === 'stopped'"
              variant="secondary"
              :loading="busy === `${database.id}:start`"
              @click="runLifecycle(database, 'start')"
            >
              Start
            </UiButton>
            <UiButton
              v-else-if="canManage && database.status === 'running'"
              variant="secondary"
              :loading="busy === `${database.id}:restart`"
              @click="runLifecycle(database, 'restart')"
            >
              Restart
            </UiButton>
            <button
              v-if="canManage"
              type="button"
              title="Remove"
              class="rounded-lg p-2 text-content-muted transition-colors hover:text-danger"
              @click="toRemove = database"
            >
              <Icon name="lucide:trash-2" class="size-4" />
            </button>
          </div>
        </div>
      </div>
    </template>

    <!-- Credentials -->
    <UiModal v-model:open="credentialsOpen" title="Connection credentials">
      <div v-if="credentials" class="flex flex-col gap-2 font-mono text-xs">
        <p><span class="text-content-muted">host:</span> {{ credentials.host }}</p>
        <p><span class="text-content-muted">port:</span> {{ credentials.port }}</p>
        <p><span class="text-content-muted">user:</span> {{ credentials.username }}</p>
        <p><span class="text-content-muted">database:</span> {{ credentials.database }}</p>
        <p class="break-all">
          <span class="text-content-muted">password:</span> {{ credentials.password }}
        </p>
        <p class="break-all">
          <span class="text-content-muted">URI:</span> {{ credentials.connectionUri }}
        </p>
      </div>
      <template #footer="{ close }">
        <UiButton @click="close">Close</UiButton>
      </template>
    </UiModal>

    <!-- Removal -->
    <UiModal
      :open="Boolean(toRemove)"
      title="Remove database"
      :description="`Remove “${toRemove?.name}”?`"
      @update:open="value => !value && (toRemove = null)"
    >
      <UiCheckbox v-model="removeData" label="Also delete the data (volume)" />
      <template #footer="{ close }">
        <UiButton variant="ghost" :disabled="removing" @click="close">Cancel</UiButton>
        <UiButton variant="danger" :loading="removing" @click="confirmRemove">Remove</UiButton>
      </template>
    </UiModal>
  </section>
</template>
