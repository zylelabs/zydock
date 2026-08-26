<script setup lang="ts">
  import {
    databaseStatusDot,
    engineLabel,
    useDatabases,
    type DatabaseStatus,
  } from '~/composables/services/useDatabases';
  import OverviewTab from './.OverviewTab.vue';
  import ConnectionTab from './.ConnectionTab.vue';
  import BackupsTab from './.BackupsTab.vue';
  import { useOrganizations } from '~/composables/services/useOrganizations';
  import { useServers } from '~/composables/services/useServers';

  const route = useRoute();
  const session = useSessionStore();

  const { current } = useOrganizations();
  const databasesApi = useDatabases();
  const serversApi = useServers();

  const databaseId = computed(() => String(route.params.databaseId));
  const canManage = computed(() => ['owner', 'admin'].includes(current.value?.role ?? ''));

  const messageOf = (error: unknown, fallback: string) =>
    (error as { message?: string }).message || fallback;

  const { markFetched } = useNavigationCache();

  const { data, refresh } = useResourceData(
    () => `database-${databaseId.value}`,
    async () => {
      if (!session.organizationId) {
        return null;
      }

      const { database } = await databasesApi.get(databaseId.value);

      markFetched(`database-${databaseId.value}`);

      return database;
    },
    {
      server: false,
      watch: [() => session.organizationId, databaseId],
      default: () => null,
    },
  );

  const database = computed(() => data.value);

  const { data: server } = useResourceData(
    () => `database-${databaseId.value}-server`,
    async () => {
      const serverId = database.value?.serverId;

      if (!serverId) {
        return null;
      }

      const { server: item } = await serversApi.get(serverId);

      return item;
    },
    { server: false, watch: [() => database.value?.serverId], default: () => null },
  );

  useHead(() => ({ title: database.value?.name ?? 'Database' }));

  const { set: setNavbar } = useNavbar();

  watchEffect(() => {
    setNavbar({
      title: database.value?.name ?? 'Database',
      context: 'Databases',
      back: '/databases',
    });
  });

  const STATUS_LABEL: Record<DatabaseStatus, string> = {
    provisioning: 'Provisioning',
    running: 'Running',
    stopped: 'Stopped',
    failed: 'Failed',
    unknown: 'Unknown',
  };

  const subtitle = computed(() => {
    if (!database.value) {
      return '';
    }

    const host = `${database.value.connection.host}:${database.value.connection.port}`;

    return server.value ? `${host} · ${server.value.name}` : host;
  });

  const actionError = ref('');

  const lifecycleBusy = ref('');

  const runLifecycle = async (action: 'restart' | 'stop' | 'start') => {
    actionError.value = '';
    lifecycleBusy.value = action;

    try {
      await databasesApi[action](databaseId.value);
      await refresh();
    } catch (error) {
      actionError.value = messageOf(error, 'The operation failed.');
    } finally {
      lifecycleBusy.value = '';
    }
  };

  const confirmDeleteOpen = ref(false);
  const deletingDatabase = ref(false);
  const removeData = ref(false);

  const handleDeleteDatabase = async () => {
    actionError.value = '';
    deletingDatabase.value = true;

    try {
      await databasesApi.remove(databaseId.value, removeData.value);

      await navigateTo('/databases');
    } catch (error) {
      actionError.value = messageOf(error, 'Failed to delete the database.');
      deletingDatabase.value = false;
    }
  };

  type TabId = 'overview' | 'connection' | 'backups';

  const TABS: { id: TabId; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'connection', label: 'Connection' },
    { id: 'backups', label: 'Backups' },
  ];

  const visibleTabs = computed(() =>
    TABS.filter(tab => tab.id !== 'connection' || canManage.value),
  );
  const activeTab = ref<TabId>('overview');

  watch(canManage, manage => {
    if (!manage && activeTab.value === 'connection') {
      activeTab.value = 'overview';
    }
  });
</script>

<template>
  <Content v-if="database">
    <Card content-class="flex flex-wrap items-center gap-4 p-4.25" class="mb-4.5">
      <div class="flex min-w-0 flex-1 items-center gap-3">
        <div
          class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent"
        >
          <Icon name="lucide:database" class="size-5" />
        </div>

        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <span class="truncate text-body font-semibold text-ink">{{ database.name }}</span>
            <Tag>{{ engineLabel(database.engine, database.version) }}</Tag>
          </div>
          <div class="truncate font-mono text-caption text-ink-2">{{ subtitle }}</div>
        </div>
      </div>

      <div class="flex shrink-0 flex-wrap items-center gap-2">
        <div
          class="flex items-center gap-1.5 rounded-full border border-edge bg-card px-2.75 py-1.25 text-[12.5px] text-ink"
        >
          <StatusDot :status="databaseStatusDot(database.status)" />
          {{ STATUS_LABEL[database.status] }}
        </div>

        <template v-if="canManage">
          <Button
            v-if="database.status === 'running'"
            theme="secondary"
            size="sm"
            :disabled="lifecycleBusy === 'stop'"
            @click="runLifecycle('stop')"
          >
            <Icon v-if="lifecycleBusy === 'stop'" name="svg-spinners:tadpole" class="size-4" />
            Stop
          </Button>
          <Button
            v-else-if="database.status === 'stopped'"
            theme="secondary"
            size="sm"
            :disabled="lifecycleBusy === 'start'"
            @click="runLifecycle('start')"
          >
            <Icon v-if="lifecycleBusy === 'start'" name="svg-spinners:tadpole" class="size-4" />
            Start
          </Button>
          <Button
            v-if="database.status === 'running'"
            theme="secondary"
            size="sm"
            :disabled="lifecycleBusy === 'restart'"
            @click="runLifecycle('restart')"
          >
            <Icon v-if="lifecycleBusy === 'restart'" name="svg-spinners:tadpole" class="size-4" />
            Restart
          </Button>
          <Button theme="destructive" size="sm" @click="confirmDeleteOpen = true">Delete</Button>
        </template>
      </div>
    </Card>

    <Alert v-if="actionError" theme="error" class="mb-4.5">{{ actionError }}</Alert>
    <Alert v-if="database.lastError" theme="error" class="mb-4.5">{{ database.lastError }}</Alert>

    <Tabs v-model="activeTab" :tabs="visibleTabs" class="mb-5" />

    <OverviewTab
      v-if="activeTab === 'overview'"
      :database="database"
      :can-manage="canManage"
      @refresh="refresh"
    />
    <ConnectionTab v-else-if="activeTab === 'connection'" :database="database" :server="server" />
    <BackupsTab v-else-if="activeTab === 'backups'" :database="database" :can-manage="canManage" />

    <Confirm
      v-model:open="confirmDeleteOpen"
      title="Delete database"
      :message="`Delete “${database.name}”? This cannot be undone.`"
      confirm-label="Delete"
      danger
      :loading="deletingDatabase"
      @confirm="handleDeleteDatabase"
    >
      <label class="mt-4 flex items-center gap-2 text-caption text-ink-2">
        <Checkbox v-model="removeData" />
        Also remove the database data
      </label>
    </Confirm>
  </Content>

  <Content v-else>
    <div class="mb-4.5 flex flex-wrap items-center gap-4">
      <Skeleton class="size-10 rounded-lg" />
      <div class="flex flex-col gap-1.5">
        <Skeleton class="h-5 w-40" />
        <Skeleton class="h-4 w-56" />
      </div>
      <div class="flex-1" />
      <Skeleton class="h-8 w-24 rounded-full" />
      <Skeleton class="h-8 w-20" />
    </div>

    <div class="mb-5 flex gap-2">
      <Skeleton v-for="index in 3" :key="index" class="h-8 w-24" />
    </div>

    <SkeletonCard :rows="4" />
  </Content>
</template>
