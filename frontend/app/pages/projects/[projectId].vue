<script setup lang="ts">
  import { z } from 'zod';
  import { applicationStatusDot, useApplications } from '~/composables/services/useApplications';
  import { useOrganizations } from '~/composables/services/useOrganizations';
  import { useProjects } from '~/composables/services/useProjects';
  import { useServers } from '~/composables/services/useServers';

  const route = useRoute();
  const toast = useToast();
  const session = useSessionStore();

  const { current } = useOrganizations();
  const projects = useProjects();
  const applications = useApplications();
  const servers = useServers();

  const projectId = computed(() => String(route.params.projectId));
  const canManage = computed(() => ['owner', 'admin'].includes(current.value?.role ?? ''));

  const countLabel = (count: number, noun: string) => `${count} ${count === 1 ? noun : `${noun}s`}`;

  const notifyError = (error: unknown, fallback: string) => {
    toast.error({
      title: 'Error',
      message: (error as { message?: string }).message || fallback,
    });
  };

  const { data, refresh } = await useAsyncData(
    () => `project-${projectId.value}`,
    async () => {
      if (!session.organizationId) {
        return null;
      }

      const [project, environmentList, serverList, applicationList] = await Promise.all([
        projects.get(projectId.value),
        projects.listEnvironments(projectId.value),
        servers.list(),
        applications.list({ projectId: projectId.value }),
      ]);

      return {
        project: project.project,
        environments: environmentList.items,
        servers: serverList.items,
        applications: applicationList.items,
      };
    },
    { server: false, watch: [() => session.organizationId, projectId] },
  );

  useHead(() => ({ title: data.value?.project.name ?? 'Project' }));

  const environments = computed(() => data.value?.environments ?? []);
  const serverList = computed(() => data.value?.servers ?? []);
  const apps = computed(() => data.value?.applications ?? []);

  const appsOf = (environmentId: string) =>
    apps.value.filter(application => application.environmentId === environmentId);

  const serverName = (serverId: string) =>
    serverList.value.find(server => server.id === serverId)?.name ?? '—';

  const environmentName = (environmentId: string) =>
    environments.value.find(environment => environment.id === environmentId)?.name ?? '—';

  const projectForm = useSchemaForm(
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

  const editingProject = ref(false);

  const openEditProject = () => {
    if (!data.value) {
      return;
    }

    projectForm.reset();
    projectForm.values.name = data.value.project.name;
    projectForm.values.description = data.value.project.description ?? '';
    editingProject.value = true;
  };

  const handleSaveProject = projectForm.submit(async values => {
    await projects.update(projectId.value, {
      name: values.name,
      description: values.description || undefined,
    });

    await refresh();
    editingProject.value = false;
  });

  const confirmDeleteProjectOpen = ref(false);
  const deletingProject = ref(false);

  const handleDeleteProject = async () => {
    deletingProject.value = true;

    try {
      await projects.remove(projectId.value);
      await navigateTo('/projects');
    } catch (error) {
      notifyError(error, 'Failed to delete the project.');
      deletingProject.value = false;
    }
  };

  const showAddEnvironment = ref(false);
  const newEnvironment = ref('');
  const addingEnvironment = ref(false);

  const handleAddEnvironment = async () => {
    if (!newEnvironment.value.trim()) {
      return;
    }

    addingEnvironment.value = true;

    try {
      await projects.createEnvironment(projectId.value, newEnvironment.value.trim());
      newEnvironment.value = '';
      showAddEnvironment.value = false;
      await refresh();
    } catch (error) {
      notifyError(error, 'Failed to create environment.');
    } finally {
      addingEnvironment.value = false;
    }
  };

  const handleRemoveEnvironment = async (environmentId: string) => {
    try {
      await projects.removeEnvironment(projectId.value, environmentId);
      await refresh();
    } catch (error) {
      notifyError(error, 'Failed to remove environment.');
    }
  };

  const renamingEnvironment = ref('');
  const renameValue = ref('');
  const renamingBusy = ref(false);

  const startRenameEnvironment = (environment: { id: string; name: string }) => {
    renamingEnvironment.value = environment.id;
    renameValue.value = environment.name;
  };

  const handleRenameEnvironment = async () => {
    if (!renameValue.value.trim()) {
      return;
    }

    renamingBusy.value = true;

    try {
      await projects.updateEnvironment(
        projectId.value,
        renamingEnvironment.value,
        renameValue.value.trim(),
      );
      renamingEnvironment.value = '';
      await refresh();
    } catch (error) {
      notifyError(error, 'Failed to rename environment.');
    } finally {
      renamingBusy.value = false;
    }
  };

  watchEffect(() => {
    useNavbar().set({
      title: data.value?.project.name ?? 'Project',
      context: 'Projects',
      action: {
        label: 'New application',
        icon: 'proicons:add',
        onClick: () => navigateTo(`/applications/new?projectId=${projectId.value}`),
      },
    });
  });
</script>

<template>
  <Content>
    <div class="flex max-w-225 flex-col gap-4.5">
      <div class="flex items-start justify-between gap-3">
        <p v-if="data?.project.description" class="text-[13.5px] text-ink-2">
          {{ data.project.description }}
        </p>
        <Button v-if="canManage" theme="quiet" size="sm" class="ml-auto" @click="openEditProject">
          Edit
        </Button>
      </div>

      <Card v-if="editingProject" title="Edit project" rows>
        <template #footer>
          <div class="flex w-full items-center justify-end gap-2">
            <Button theme="quiet" size="sm" type="button" @click="editingProject = false">
              Cancel
            </Button>
            <Button
              theme="primary"
              size="sm"
              :disabled="projectForm.loading.value"
              @click="handleSaveProject"
            >
              <Icon v-if="projectForm.loading.value" name="svg-spinners:tadpole" size="16" />
              Save
            </Button>
          </div>
        </template>

        <div class="flex flex-col">
          <Input
            v-model="projectForm.values.name"
            label="Name"
            boxed
            :call-error="projectForm.errors.value.name"
            :disabled="projectForm.loading.value"
          />
          <Input
            v-model="projectForm.values.description"
            label="Description"
            type="textarea"
            :rows="3"
            boxed
            :disabled="projectForm.loading.value"
          />
        </div>
      </Card>

      <div class="rounded-card border border-edge bg-card p-4.25">
        <div class="mb-3.25 flex items-center gap-2.5">
          <div class="flex-1 text-[13px] font-semibold text-ink">Environments</div>
          <Button
            v-if="canManage && !showAddEnvironment"
            theme="secondary"
            size="xs"
            @click="showAddEnvironment = true"
          >
            Add environment
          </Button>
        </div>

        <form
          v-if="showAddEnvironment"
          class="mb-3 flex items-center gap-2"
          @submit.prevent="handleAddEnvironment"
        >
          <Input v-model="newEnvironment" class="flex-1" placeholder="staging" boxed bare />
          <Button theme="secondary" size="xs" type="submit" :disabled="addingEnvironment">
            <Icon v-if="addingEnvironment" name="svg-spinners:tadpole" size="16" />
            Add
          </Button>
          <Button theme="quiet" size="xs" type="button" @click="showAddEnvironment = false">
            Cancel
          </Button>
        </form>

        <div class="flex flex-wrap gap-2">
          <template v-for="environment in environments" :key="environment.id">
            <form
              v-if="renamingEnvironment === environment.id"
              class="flex items-center gap-2"
              @submit.prevent="handleRenameEnvironment"
            >
              <Input v-model="renameValue" class="w-40" boxed bare />
              <Button theme="secondary" size="xs" type="submit" :disabled="renamingBusy">
                <Icon v-if="renamingBusy" name="svg-spinners:tadpole" size="16" />
                Save
              </Button>
              <Button theme="quiet" size="xs" type="button" @click="renamingEnvironment = ''">
                Cancel
              </Button>
            </form>

            <div
              v-else
              class="group flex items-center gap-2 rounded-full border border-edge bg-row-hover px-3 py-1.5 text-[13px] text-ink"
            >
              <span>{{ environment.name }}</span>
              <span class="text-[11.5px] text-ink-3">{{ appsOf(environment.id).length }}</span>
              <template v-if="canManage">
                <button
                  type="button"
                  title="Rename environment"
                  class="cursor-pointer text-ink-3 hover:text-ink"
                  @click="startRenameEnvironment(environment)"
                >
                  <Icon name="lucide:pencil" class="size-3" />
                </button>
                <button
                  v-if="environments.length > 1"
                  type="button"
                  title="Remove environment"
                  class="cursor-pointer text-ink-3 hover:text-failed"
                  @click="handleRemoveEnvironment(environment.id)"
                >
                  <Icon name="lucide:x" class="size-3" />
                </button>
              </template>
            </div>
          </template>
        </div>
      </div>

      <Card title="Applications" content-class="p-0">
        <template #right>
          <Button
            theme="primary"
            size="xs"
            @click="navigateTo(`/applications/new?projectId=${projectId}`)"
          >
            New application
          </Button>
        </template>

        <EmptyState
          v-if="!apps.length"
          variant="prompt"
          description="No applications in this project yet."
          class="m-2.5"
        />

        <Row
          v-for="app in apps"
          :key="app.id"
          :to="`/applications/${app.id}`"
          class="grid-cols-[1.3fr_1fr_0.8fr_auto] gap-4"
        >
          <div class="flex min-w-0 items-center gap-2.5">
            <StatusDot :status="applicationStatusDot(app.status)" />
            <span class="truncate text-[13.5px] font-medium text-ink">{{ app.name }}</span>
          </div>
          <div class="truncate font-mono text-caption text-ink-2">{{ app.git.repository }}</div>
          <div class="truncate text-caption text-ink-2">
            {{ environmentName(app.environmentId) }}
          </div>
          <div class="text-caption text-ink-3">{{ serverName(app.serverId) }}</div>
        </Row>
      </Card>

      <div
        v-if="canManage && data"
        class="flex items-center gap-4 rounded-card border border-failed/30 bg-failed/5 p-4.25"
      >
        <div class="flex-1">
          <div class="text-[13px] font-semibold text-failed">Delete this project</div>
          <div class="mt-0.75 text-caption text-ink-2">
            {{ countLabel(apps.length, 'application') }} and
            {{ countLabel(environments.length, 'environment') }} go with it.
          </div>
        </div>
        <Button
          theme="destructive"
          size="sm"
          class="shrink-0"
          @click="confirmDeleteProjectOpen = true"
        >
          Delete
        </Button>
      </div>
    </div>

    <Confirm
      v-model:open="confirmDeleteProjectOpen"
      title="Delete project"
      :message="`Delete “${data?.project.name}”? ${countLabel(apps.length, 'application')} and ${countLabel(environments.length, 'environment')} are removed too. This cannot be undone.`"
      confirm-label="Delete"
      danger
      :loading="deletingProject"
      @confirm="handleDeleteProject"
    />
  </Content>
</template>
