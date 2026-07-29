<script setup lang="ts">
  import type { ApplicationStatus } from '~/composables/use-applications';

  type Health = {
    status: string;
    dependencies: Record<string, { status: string }>;
  };

  useHead({ title: 'Overview' });

  const SERIES_DAYS = 7;

  const STATUS_VARIANTS: Record<ApplicationStatus, 'neutral' | 'success' | 'warning' | 'danger'> = {
    created: 'neutral',
    deploying: 'warning',
    running: 'success',
    stopped: 'neutral',
    failed: 'danger',
  };

  const api = useApi();
  const session = useSessionStore();
  const { current } = useOrganizations();
  const servers = useServers();
  const applications = useApplications();
  const projects = useProjects();
  const deployments = useDeployments();

  const { data: health } = await useAsyncData('health', () =>
    api.get<Health>('/health', { anonymous: true }),
  );

  const { data, status, refresh } = await useAsyncData(
    'overview',
    async () => {
      if (!session.organizationId) {
        return null;
      }

      const [serverList, applicationList, projectList, deploymentList] = await Promise.all([
        servers.list(),
        applications.list(),
        projects.list(),
        deployments.list(),
      ]);

      return {
        servers: serverList.items,
        applications: applicationList.items,
        projects: projectList.items,
        deployments: deploymentList.items,
        totals: {
          servers: serverList.total,
          applications: applicationList.total,
          deployments: deploymentList.total,
        },
      };
    },
    { server: false, watch: [() => session.organizationId] },
  );

  const cards = computed(() => {
    const serverList = data.value?.servers ?? [];
    const applicationList = data.value?.applications ?? [];
    const deploymentList = data.value?.deployments ?? [];

    const newServers = dailyCounts(
      serverList.map(server => server.createdAt),
      SERIES_DAYS,
    ).reduce((total, count) => total + count, 0);

    const newApplications = dailyCounts(
      applicationList.map(application => application.createdAt),
      SERIES_DAYS,
    ).reduce((total, count) => total + count, 0);

    return [
      {
        label: 'Servers',
        icon: 'lucide:server',
        value: data.value?.totals.servers ?? 0,
        highlight: `${serverList.filter(server => server.online).length} online`,
        caption: `+${newServers} this week`,
        points: dailyCumulative(
          serverList.map(server => server.createdAt),
          SERIES_DAYS,
        ),
      },
      {
        label: 'Applications',
        icon: 'lucide:box',
        value: data.value?.totals.applications ?? 0,
        highlight: `${applicationList.filter(item => item.status === 'running').length} running`,
        caption: `+${newApplications} this week`,
        points: dailyCumulative(
          applicationList.map(application => application.createdAt),
          SERIES_DAYS,
        ),
      },
      {
        label: 'Deployments',
        icon: 'lucide:rocket',
        value: data.value?.totals.deployments ?? 0,
        highlight: `${deploymentList.filter(item => item.status === 'succeeded').length} succeeded`,
        caption: `in the last ${deploymentList.length} runs`,
        points: dailyCounts(
          deploymentList.map(deployment => deployment.createdAt),
          SERIES_DAYS,
        ),
      },
    ];
  });

  const filter = ref('all');
  const search = ref('');

  const tabs = computed(() => {
    const applicationList = data.value?.applications ?? [];
    const countOf = (value: ApplicationStatus) =>
      applicationList.filter(application => application.status === value).length;

    return [
      { label: 'All', value: 'all', count: applicationList.length },
      { label: 'Running', value: 'running', count: countOf('running') },
      { label: 'Deploying', value: 'deploying', count: countOf('deploying') },
      { label: 'Stopped', value: 'stopped', count: countOf('stopped') },
      { label: 'Failed', value: 'failed', count: countOf('failed') },
    ];
  });

  const rows = computed(() => {
    const projectNames = new Map(
      (data.value?.projects ?? []).map(project => [project.id, project.name]),
    );
    const deploymentList = data.value?.deployments ?? [];
    const term = search.value.trim().toLowerCase();

    return (data.value?.applications ?? [])
      .filter(application => filter.value === 'all' || application.status === filter.value)
      .filter(
        application =>
          !term ||
          application.name.toLowerCase().includes(term) ||
          application.git.repository.toLowerCase().includes(term),
      )
      .map(application => {
        const runs = deploymentList.filter(
          deployment => deployment.applicationId === application.id,
        ).length;

        return {
          id: application.id,
          name: application.name,
          status: application.status,
          project: projectNames.get(application.projectId) ?? '—',
          repository: application.git.repository,
          branch: application.git.branch,
          runs,
          share: deploymentList.length ? Math.round((runs / deploymentList.length) * 100) : 0,
        };
      });
  });
</script>

<template>
  <section class="flex flex-col gap-5">
    <header class="flex flex-wrap items-center gap-4">
      <div class="flex-1">
        <h1>Overview</h1>
        <p class="mt-1 flex items-center gap-2 text-sm text-content-muted">
          <span
            :class="['size-1.5 rounded-full', health?.status === 'ok' ? 'bg-success' : 'bg-danger']"
          />
          API {{ health?.status ?? 'unreachable' }}
        </p>
      </div>

      <UiButton variant="secondary" :loading="status === 'pending'" @click="refresh()">
        <Icon v-if="status !== 'pending'" name="lucide:refresh-cw" class="size-4" />
        Refresh
      </UiButton>

      <UiButton variant="secondary" @click="navigateTo('/observability')">
        <Icon name="lucide:activity" class="size-4" />
        Observability
      </UiButton>
    </header>

    <UiCard v-if="!current" title="Select an organization">
      <p class="text-sm text-content-muted">Choose or create an organization in the sidebar.</p>
    </UiCard>

    <template v-else>
      <div class="grid gap-5 lg:grid-cols-3">
        <StatCard
          v-for="card in cards"
          :key="card.label"
          :label="card.label"
          :icon="card.icon"
          :value="card.value"
          :highlight="card.highlight"
          :caption="card.caption"
          :points="card.points"
        />
      </div>

      <UiCard flush>
        <template #header>
          <div class="flex items-center gap-3">
            <h2 class="flex-1">Applications</h2>
            <span class="text-sm text-content-muted">{{ rows.length }} shown</span>
          </div>
        </template>

        <div class="flex flex-wrap items-center gap-3 px-5 pb-4">
          <UiTabs v-model="filter" :items="tabs" />

          <div class="flex-1" />

          <label
            class="flex w-70 items-center gap-2 rounded-lg border border-surface-line bg-surface-sunken px-3 py-2"
          >
            <Icon name="lucide:search" class="size-4 shrink-0 text-content-muted" />
            <input
              v-model="search"
              type="search"
              placeholder="Search applications"
              class="w-full bg-transparent text-sm text-content outline-none placeholder:text-content-muted"
            />
          </label>
        </div>

        <div class="overflow-x-auto">
          <div class="min-w-225">
            <div
              class="grid grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,2fr)_minmax(0,2.2fr)_minmax(0,1.1fr)_70px] items-center gap-3 border-y border-surface-line bg-surface-sunken px-5 py-2.5 text-xs font-medium text-content-muted"
            >
              <span>Application</span>
              <span>Project</span>
              <span>Repository</span>
              <span>Recent deploys</span>
              <span>Status</span>
              <span />
            </div>

            <p v-if="!rows.length" class="px-5 py-8 text-center text-sm text-content-muted">
              No applications to show.
            </p>

            <div
              v-for="row in rows"
              :key="row.id"
              class="grid grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,2fr)_minmax(0,2.2fr)_minmax(0,1.1fr)_70px] items-center gap-3 border-b border-surface-line px-5 py-3.5 text-sm transition-colors last:border-b-0 hover:bg-surface-hover/40"
            >
              <span class="flex min-w-0 items-center gap-2.5">
                <span
                  class="flex size-5 shrink-0 items-center justify-center rounded-md bg-surface-hover"
                >
                  <Icon name="lucide:box" class="size-3 text-content-muted" />
                </span>
                <NuxtLink
                  :to="`/applications/${row.id}`"
                  class="truncate font-medium text-content-strong hover:underline"
                >
                  {{ row.name }}
                </NuxtLink>
              </span>

              <span class="truncate text-content-muted">{{ row.project }}</span>

              <span class="min-w-0 truncate">
                {{ row.repository }}
                <span class="text-content-dim">#{{ row.branch }}</span>
              </span>

              <span class="flex items-center gap-3">
                <span class="h-2 flex-1 overflow-hidden rounded-md bg-surface-hover">
                  <span
                    class="block h-full rounded-md bg-linear-to-r from-primary/50 to-primary"
                    :style="{ width: `${row.share}%` }"
                  />
                </span>
                <span class="w-16 shrink-0 text-content-muted">{{ row.runs }} runs</span>
              </span>

              <span>
                <UiBadge :variant="STATUS_VARIANTS[row.status]">
                  <span class="size-1.5 rounded-full bg-current" />
                  {{ row.status }}
                </UiBadge>
              </span>

              <span class="flex items-center justify-end gap-3 text-content-muted">
                <NuxtLink :to="`/applications/${row.id}/logs`" title="Logs">
                  <Icon name="lucide:scroll-text" class="size-4 hover:text-content-strong" />
                </NuxtLink>
                <NuxtLink :to="`/applications/${row.id}`" title="Open">
                  <Icon name="lucide:arrow-up-right" class="size-4 hover:text-content-strong" />
                </NuxtLink>
              </span>
            </div>
          </div>
        </div>
      </UiCard>
    </template>
  </section>
</template>
