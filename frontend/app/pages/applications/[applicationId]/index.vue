<script setup lang="ts">
  import OverviewTab from './.OverviewTab.vue';
  import NetworkTab from './.NetworkTab.vue';
  import VariablesTab from './.VariablesTab.vue';
  import SettingsTab from './.SettingsTab.vue';
  import ComposeTab from './.ComposeTab.vue';
  import FilesTab from './.FilesTab.vue';
  import {
    applicationExposeKind,
    applicationStatusDot,
    useApplications,
    type ApplicationStatus,
  } from '~/composables/services/useApplications';
  import { useDomains } from '~/composables/services/useDomains';
  import { useOrganizations } from '~/composables/services/useOrganizations';
  import { useProjects } from '~/composables/services/useProjects';
  import { useServers } from '~/composables/services/useServers';

  const route = useRoute();
  const session = useSessionStore();
  const recentApplications = useRecentApplicationsStore();

  const { current } = useOrganizations();
  const applicationsApi = useApplications();
  const domainsApi = useDomains();
  const projectsApi = useProjects();
  const serversApi = useServers();

  const applicationId = computed(() => String(route.params.applicationId));
  const canManage = computed(() => ['owner', 'admin'].includes(current.value?.role ?? ''));

  const messageOf = (error: unknown, fallback: string) =>
    (error as { message?: string }).message || fallback;

  const { getCachedData, markFetched } = useNavigationCache();

  const { data, refresh } = useLazyAsyncData(
    () => `application-${applicationId.value}`,
    async () => {
      if (!session.organizationId) {
        return null;
      }

      const { application } = await applicationsApi.get(applicationId.value);

      markFetched(`application-${applicationId.value}`);

      return application;
    },
    {
      server: false,
      watch: [() => session.organizationId, applicationId],
      default: () => null,
      getCachedData: key => getCachedData(key),
    },
  );

  const application = computed(() => data.value);

  watch(application, current => {
    if (!current || !session.organizationId) {
      return;
    }

    recentApplications.sync(session.organizationId, {
      id: current.id,
      name: current.name,
      status: current.status,
    });
  });

  const { data: domainsData } = useLazyAsyncData(
    () => `application-${applicationId.value}-primary-domain`,
    () =>
      session.organizationId
        ? domainsApi.list({ applicationId: applicationId.value })
        : Promise.resolve(null),
    { server: false, watch: [() => session.organizationId, applicationId], default: () => null },
  );

  const { data: server } = useLazyAsyncData(
    () => `application-${applicationId.value}-server`,
    async () => {
      const serverId = application.value?.serverId;

      if (!serverId) {
        return null;
      }

      const { server: item } = await serversApi.get(serverId);

      return item;
    },
    { server: false, watch: [() => application.value?.serverId], default: () => null },
  );

  const exposeKind = computed(() =>
    application.value ? applicationExposeKind(application.value) : 'http',
  );

  const applicationUrl = computed(() => {
    const domains = domainsData.value?.items ?? [];
    const domain = domains.find(item => item.status === 'active') ?? domains[0];

    if (domain) {
      const label = `${domain.hostname}${domain.pathPrefix ?? ''}`;

      return { href: `${domain.tls ? 'https' : 'http'}://${label}`, label, local: false };
    }

    const mappings = application.value?.portMappings ?? [];
    const mapping =
      mappings.find(item => item.containerPort === application.value?.port) ?? mappings[0];
    const host = server.value?.publicIp;

    if (!mapping || !host) {
      return null;
    }

    const label = `${host}:${mapping.hostPort}`;

    return {
      href: exposeKind.value === 'http' ? `http://${label}` : undefined,
      label,
      protocol: mapping.protocol,
      local: true,
    };
  });

  const copiedApplicationUrl = ref(false);

  const copyApplicationUrl = async () => {
    if (!applicationUrl.value) {
      return;
    }

    await navigator.clipboard.writeText(applicationUrl.value.label);
    copiedApplicationUrl.value = true;
    setTimeout(() => (copiedApplicationUrl.value = false), 2000);
  };

  useHead(() => ({ title: application.value?.name ?? 'Application' }));

  const navbarContext = ref('Applications');
  const navbarBack = ref('/applications');

  watch(
    application,
    async current => {
      if (!current) {
        navbarContext.value = 'Applications';
        navbarBack.value = '/applications';
        return;
      }

      navbarBack.value = `/projects/${current.projectId}`;

      const [{ project }, environments] = await Promise.all([
        projectsApi.get(current.projectId),
        projectsApi.listEnvironments(current.projectId),
      ]);

      const environment = environments.items.find(item => item.id === current.environmentId);

      navbarContext.value = [project.name, environment?.name].filter(Boolean).join(' · ');
    },
    { immediate: true },
  );

  const STATUS_LABEL: Record<ApplicationStatus, string> = {
    created: 'Created',
    deploying: 'Deploying',
    running: 'Running',
    stopped: 'Stopped',
    failed: 'Failed',
  };

  const actionError = ref('');

  const deploying = ref(false);

  const triggerDeploy = async () => {
    actionError.value = '';
    deploying.value = true;

    try {
      const { deployment } = await applicationsApi.deploy(applicationId.value);

      await navigateTo(`/applications/${applicationId.value}/deployments/${deployment.id}`);
    } catch (error) {
      actionError.value = messageOf(error, 'Failed to start the deployment.');
    } finally {
      deploying.value = false;
    }
  };

  const lifecycleBusy = ref('');

  const runLifecycle = async (action: 'restart' | 'stop' | 'start') => {
    actionError.value = '';
    lifecycleBusy.value = action;

    try {
      await applicationsApi[action](applicationId.value);
      await refresh();
    } catch (error) {
      actionError.value = messageOf(error, 'The operation failed.');
    } finally {
      lifecycleBusy.value = '';
    }
  };

  type TabId = 'overview' | 'network' | 'variables' | 'files' | 'compose' | 'settings';

  const TABS: { id: TabId; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'network', label: 'Domains & network' },
    { id: 'variables', label: 'Variables' },
    { id: 'files', label: 'Files' },
    { id: 'compose', label: 'Compose' },
    { id: 'settings', label: 'Settings' },
  ];

  const visibleTabs = computed(() => {
    const tabs = TABS.filter(tab => {
      if (tab.id === 'compose') {
        return application.value?.source === 'compose';
      }

      if (tab.id === 'files') {
        return Boolean(application.value?.volumes?.length);
      }

      return true;
    });

    return canManage.value ? tabs : tabs.filter(tab => tab.id === 'overview' || tab.id === 'files');
  });
  const isKnownTab = (value: unknown): value is TabId => TABS.some(tab => tab.id === value);

  const initialTab = route.query.tab;
  const activeTab = ref<TabId>(isKnownTab(initialTab) ? initialTab : 'overview');

  watch(visibleTabs, tabs => {
    if (!tabs.some(tab => tab.id === activeTab.value)) {
      activeTab.value = 'overview';
    }
  });

  const { set: setNavbar } = useNavbar();

  watchEffect(() => {
    setNavbar({
      title: application.value?.name ?? 'Application',
      context: navbarContext.value,
      back: navbarBack.value,
    });
  });
</script>

<template>
  <Content v-if="application">
    <Card content-class="flex flex-wrap items-center gap-4 p-4.25" class="mb-4.5">
      <div class="flex min-w-0 flex-1 items-center gap-3">
        <div
          class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent"
        >
          <Icon name="lucide:box" class="size-5" />
        </div>

        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <span class="truncate text-body font-semibold text-ink">{{ application.name }}</span>
            <Tag v-if="application.origin">Template · {{ application.origin.templateId }}</Tag>
          </div>

          <div class="flex min-w-0 items-center gap-1.5 font-mono text-caption text-ink-2">
            <a
              v-if="applicationUrl?.href"
              :href="applicationUrl.href"
              target="_blank"
              rel="noopener noreferrer"
              class="flex min-w-0 items-center gap-1.5 transition-colors hover:text-ink"
            >
              <span class="truncate">{{ applicationUrl.label }}</span>
              <span v-if="applicationUrl.local" class="shrink-0 font-sans">(local)</span>
              <Tag v-if="applicationUrl.protocol">{{ applicationUrl.protocol }}</Tag>
              <Icon name="lucide:external-link" class="size-3.5 shrink-0" />
            </a>
            <button
              v-else-if="applicationUrl"
              type="button"
              class="flex min-w-0 cursor-pointer items-center gap-1.5 transition-colors hover:text-ink"
              @click="copyApplicationUrl"
            >
              <span class="truncate">{{ applicationUrl.label }}</span>
              <Tag v-if="applicationUrl.protocol">{{ applicationUrl.protocol }}</Tag>
              <Icon
                :name="copiedApplicationUrl ? 'lucide:check' : 'lucide:copy'"
                class="size-3.5 shrink-0"
              />
            </button>
            <span v-else class="truncate">{{ application.slug }}</span>
            <span v-if="server" class="truncate">· {{ server.name }}</span>
          </div>
        </div>
      </div>

      <div class="flex shrink-0 flex-wrap items-center gap-2">
        <div
          class="flex items-center gap-1.5 rounded-full border border-edge bg-card px-2.75 py-1.25 text-[12.5px] text-ink"
        >
          <StatusDot :status="applicationStatusDot(application.status)" />
          {{ STATUS_LABEL[application.status] }}
        </div>

        <Button theme="secondary" size="sm" :to="`/applications/${application.id}/logs`">
          Logs
        </Button>
        <Button theme="secondary" size="sm" :to="`/applications/${application.id}/console`">
          Console
        </Button>

        <template v-if="canManage">
          <Button
            v-if="application.status === 'running'"
            theme="secondary"
            size="sm"
            :disabled="lifecycleBusy === 'stop'"
            @click="runLifecycle('stop')"
          >
            <Icon v-if="lifecycleBusy === 'stop'" name="svg-spinners:tadpole" class="size-4" />
            Stop
          </Button>
          <Button
            v-else-if="application.status === 'stopped'"
            theme="secondary"
            size="sm"
            :disabled="lifecycleBusy === 'start'"
            @click="runLifecycle('start')"
          >
            <Icon v-if="lifecycleBusy === 'start'" name="svg-spinners:tadpole" class="size-4" />
            Start
          </Button>
          <Button
            v-if="application.status === 'running'"
            theme="secondary"
            size="sm"
            :disabled="lifecycleBusy === 'restart'"
            @click="runLifecycle('restart')"
          >
            <Icon v-if="lifecycleBusy === 'restart'" name="svg-spinners:tadpole" class="size-4" />
            Restart
          </Button>
          <Button theme="primary" size="sm" :disabled="deploying" @click="triggerDeploy">
            <Icon v-if="deploying" name="svg-spinners:tadpole" class="size-4" />
            {{ application.status === 'created' ? 'Deploy' : 'Redeploy' }}
          </Button>
        </template>
      </div>
    </Card>

    <Alert v-if="actionError" theme="error" class="mb-4.5">{{ actionError }}</Alert>
    <Alert v-if="application.lastError" theme="error" class="mb-4.5">{{
      application.lastError
    }}</Alert>

    <Tabs v-model="activeTab" :tabs="visibleTabs" class="mb-5" />

    <OverviewTab
      v-if="activeTab === 'overview'"
      :application="application"
      :can-manage="canManage"
      :expose-kind="exposeKind"
      @refresh="refresh"
    />
    <NetworkTab
      v-else-if="activeTab === 'network'"
      :application="application"
      :can-manage="canManage"
      :expose-kind="exposeKind"
      @refresh="refresh"
    />
    <VariablesTab
      v-else-if="activeTab === 'variables'"
      :application="application"
      :can-manage="canManage"
    />
    <FilesTab
      v-else-if="activeTab === 'files'"
      :application="application"
      :can-manage="canManage"
    />
    <ComposeTab
      v-else-if="activeTab === 'compose'"
      :application="application"
      :can-manage="canManage"
    />
    <SettingsTab v-else :application="application" :can-manage="canManage" @refresh="refresh" />
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
      <Skeleton v-for="index in 4" :key="index" class="h-8 w-24" />
    </div>

    <div class="grid gap-4.5 lg:grid-cols-[1.4fr_1fr]">
      <div class="flex flex-col gap-4.5">
        <div class="grid gap-3.5 sm:grid-cols-3">
          <SkeletonChart v-for="index in 3" :key="index" />
        </div>
        <SkeletonCard :rows="4" />
      </div>
      <SkeletonCard :rows="8" />
    </div>
  </Content>
</template>
