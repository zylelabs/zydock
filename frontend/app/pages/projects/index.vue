<script setup lang="ts">
  import { z } from 'zod';
  import { useApplications } from '~/composables/services/useApplications';
  import { useOrganizations } from '~/composables/services/useOrganizations';
  import { useProjects, type Environment } from '~/composables/services/useProjects';

  useHead({ title: 'Projects' });

  const toast = useToast();
  const session = useSessionStore();
  const { current } = useOrganizations();
  const { list: listProjects, create, listEnvironments } = useProjects();
  const { list: listApplications } = useApplications();

  const canManage = computed(() => ['owner', 'admin'].includes(current.value?.role ?? ''));

  const load = async () => {
    const [projects, applications] = await Promise.all([listProjects(), listApplications()]);

    const environmentLists = await Promise.all(
      projects.items.map(project => listEnvironments(project.id)),
    );

    const appCountByProject = new Map<string, number>();

    for (const application of applications.items) {
      appCountByProject.set(
        application.projectId,
        (appCountByProject.get(application.projectId) ?? 0) + 1,
      );
    }

    return {
      items: projects.items,
      appCount: appCountByProject,
      envCount: new Map(
        projects.items.map((project, index) => [
          project.id,
          environmentLists[index]?.total ??
            (environmentLists[index]?.items as Environment[])?.length ??
            0,
        ]),
      ),
    };
  };

  const empty = {
    items: [],
    appCount: new Map<string, number>(),
    envCount: new Map<string, number>(),
  };

  const { getCachedData, markFetched } = useNavigationCache();

  const { data, status, refresh } = useLazyAsyncData(
    'projects',
    async () => {
      const result = session.organizationId ? await load() : empty;

      markFetched('projects');

      return result;
    },
    {
      server: false,
      watch: [() => session.organizationId],
      default: () => empty,
      getCachedData: key => getCachedData(key),
    },
  );

  const hasLoadedOnce = ref(false);

  watch(
    status,
    value => {
      if (value !== 'pending') {
        hasLoadedOnce.value = true;
      }
    },
    { immediate: true },
  );

  const projects = computed(() => data.value?.items ?? []);

  const countLabel = (count: number, noun: string) => `${count} ${count === 1 ? noun : `${noun}s`}`;

  const showCreate = ref(false);

  const form = useSchemaForm(
    z.object({
      name: z.string().trim().min(1, 'Enter a name'),
      description: z.string().trim(),
    }),
    { name: '', description: '' },
    {
      onError: message => toast.error({ title: 'Error', message }),
      onInvalid: (_errors, lastError) => toast.error({ title: 'Error', message: lastError }),
    },
  );

  const handleCreate = form.submit(async values => {
    const { project } = await create(values.name, values.description || undefined);

    showCreate.value = false;
    await refresh();
    await navigateTo(`/projects/${project.id}`);
  });

  const { set: setNavbar } = useNavbar();

  watchEffect(() => {
    setNavbar({
      title: 'Projects',
      context: current.value?.name,
      action:
        current.value && canManage.value
          ? {
              label: 'New project',
              icon: 'proicons:add',
              onClick: () => {
                form.reset();
                showCreate.value = !showCreate.value;
              },
            }
          : undefined,
    });
  });
</script>

<template>
  <Content>
    <EmptyState
      v-if="!current"
      variant="action"
      title="Select an organization"
      description="Choose or create an organization in the sidebar selector to see its projects."
    />

    <div v-else class="flex flex-col gap-4">
      <Card v-if="showCreate" title="New project" rows class="max-w-155">
        <template #footer>
          <div class="flex w-full items-center justify-between gap-3">
            <p class="text-caption text-ink-2">
              A first environment named production is created with it.
            </p>
            <Button theme="primary" size="sm" :disabled="form.loading.value" @click="handleCreate">
              <Icon v-if="form.loading.value" name="svg-spinners:tadpole" size="16" />
              Create
            </Button>
          </div>
        </template>

        <div class="flex flex-col">
          <Input
            v-model="form.values.name"
            label="Name"
            placeholder="Payments"
            boxed
            :call-error="form.errors.value.name"
          />
          <Input
            v-model="form.values.description"
            label="Description"
            placeholder="Optional"
            boxed
          />
        </div>
      </Card>

      <div
        v-if="status === 'pending' && !hasLoadedOnce"
        class="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4"
      >
        <SkeletonCard v-for="index in 3" :key="index" :rows="2" />
      </div>

      <EmptyState
        v-else-if="!projects.length"
        variant="prompt"
        description="No projects yet. Create one to start grouping environments and applications."
      />

      <div v-else class="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
        <NuxtLink
          v-for="project in projects"
          :key="project.id"
          :to="`/projects/${project.id}`"
          class="flex flex-col gap-3 rounded-card border border-edge bg-card p-4.5 transition-colors hover:border-edge-strong"
        >
          <div class="text-[15px] font-semibold tracking-[-0.01em] text-ink">
            {{ project.name }}
          </div>
          <p class="flex-1 text-[13px] leading-normal text-pretty text-ink-2">
            {{ project.description || 'No description.' }}
          </p>
          <div class="flex gap-3.5 border-t border-hairline pt-2.75 text-caption text-ink-3">
            <span>{{ countLabel(data?.appCount.get(project.id) ?? 0, 'application') }}</span>
            <span>{{ countLabel(data?.envCount.get(project.id) ?? 0, 'environment') }}</span>
          </div>
        </NuxtLink>
      </div>
    </div>
  </Content>
</template>
