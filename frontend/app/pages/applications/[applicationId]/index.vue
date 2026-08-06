<script setup lang="ts">
  import OverviewTab from './.OverviewTab.vue';
  import NetworkTab from './.NetworkTab.vue';
  import VariablesTab from './.VariablesTab.vue';
  import AdvancedTab from './.AdvancedTab.vue';
  import {
    applicationStatusDot,
    useApplications,
    type ApplicationStatus,
  } from '~/composables/services/useApplications';
  import { useOrganizations } from '~/composables/services/useOrganizations';
  import { useProjects } from '~/composables/services/useProjects';

  const route = useRoute();
  const session = useSessionStore();

  const { current } = useOrganizations();
  const applicationsApi = useApplications();
  const projectsApi = useProjects();

  const applicationId = computed(() => String(route.params.applicationId));
  const canManage = computed(() => ['owner', 'admin'].includes(current.value?.role ?? ''));

  const messageOf = (error: unknown, fallback: string) =>
    (error as { message?: string }).message || fallback;

  const { data, refresh } = await useAsyncData(
    () => `application-${applicationId.value}`,
    async () => {
      if (!session.organizationId) {
        return null;
      }

      const { application } = await applicationsApi.get(applicationId.value);

      return application;
    },
    { server: false, watch: [() => session.organizationId, applicationId] },
  );

  const application = computed(() => data.value);

  useHead(() => ({ title: application.value?.name ?? 'Application' }));

  const navbarContext = ref('Applications');

  watch(
    application,
    async current => {
      if (!current) {
        navbarContext.value = 'Applications';
        return;
      }

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

  type TabId = 'overview' | 'network' | 'variables' | 'advanced';

  const TABS: { id: TabId; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'network', label: 'Domains & network' },
    { id: 'variables', label: 'Variables' },
    { id: 'advanced', label: 'Advanced' },
  ];

  const visibleTabs = computed(() =>
    canManage.value ? TABS : TABS.filter(tab => tab.id === 'overview'),
  );
  const activeTab = ref<TabId>('overview');

  watch(canManage, manage => {
    if (!manage) {
      activeTab.value = 'overview';
    }
  });

  watchEffect(() => {
    useNavbar().set({
      title: application.value?.name ?? 'Application',
      context: navbarContext.value,
    });
  });
</script>

<template>
  <Content v-if="application">
    <div class="mb-4.5 flex flex-wrap items-center gap-2.5">
      <div
        class="flex items-center gap-1.5 rounded-full border border-edge bg-card px-2.75 py-1.25 text-[12.5px] text-ink"
      >
        <StatusDot :status="applicationStatusDot(application.status)" />
        {{ STATUS_LABEL[application.status] }}
      </div>

      <div class="flex-1" />

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

    <Alert v-if="actionError" theme="error" class="mb-4.5">{{ actionError }}</Alert>
    <Alert v-if="application.lastError" theme="error" class="mb-4.5">{{
      application.lastError
    }}</Alert>

    <Tabs v-model="activeTab" :tabs="visibleTabs" class="mb-5" />

    <OverviewTab
      v-if="activeTab === 'overview'"
      :application="application"
      :can-manage="canManage"
      @refresh="refresh"
    />
    <NetworkTab
      v-else-if="activeTab === 'network'"
      :application="application"
      :can-manage="canManage"
      @refresh="refresh"
    />
    <VariablesTab
      v-else-if="activeTab === 'variables'"
      :application="application"
      :can-manage="canManage"
    />
    <AdvancedTab v-else :application="application" :can-manage="canManage" @refresh="refresh" />
  </Content>

  <Content v-else>
    <p class="py-16 text-center text-caption text-ink-2">Loading…</p>
  </Content>
</template>
