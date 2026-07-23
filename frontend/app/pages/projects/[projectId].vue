<script setup lang="ts">
  import { z } from 'zod';
  import type { ApplicationStatus } from '~/composables/use-applications';

  const route = useRoute();
  const session = useSessionStore();
  const projectId = computed(() => String(route.params.projectId));

  const { current } = useOrganizations();
  const projects = useProjects();
  const applications = useApplications();
  const servers = useServers();

  const canManage = computed(() => ['owner', 'admin'].includes(current.value?.role ?? ''));
  const actionError = ref('');

  const { data, refresh } = await useAsyncData(
    () => `project-${projectId.value}`,
    async () => {
      if (!session.organizationId) {
        return null;
      }

      const [project, environments, serverList, apps] = await Promise.all([
        projects.get(projectId.value),
        projects.listEnvironments(projectId.value),
        servers.list(),
        applications.list({ projectId: projectId.value }),
      ]);

      return {
        project: project.project,
        environments: environments.items,
        servers: serverList.items,
        applications: apps.items,
      };
    },
    { server: false, watch: [() => session.organizationId, projectId] },
  );

  useHead(() => ({ title: data.value?.project.name ?? 'Project' }));

  const environments = computed(() => data.value?.environments ?? []);
  const serverList = computed(() => data.value?.servers ?? []);
  const apps = computed(() => data.value?.applications ?? []);

  // --- Edit project ---------------------------------------------------------------------------------

  const projectForm = useForm(
    z.object({
      name: z.string().trim().min(1, 'Enter a name'),
      description: z.string().trim(),
    }),
    { name: '', description: '' },
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

  const onSaveProject = projectForm.submit(async values => {
    await projects.update(projectId.value, {
      name: values.name,
      description: values.description || undefined,
    });

    await refresh();
    editingProject.value = false;
  });

  // --- Delete project ---------------------------------------------------------------------------

  const confirmDeleteProjectOpen = ref(false);
  const deletingProject = ref(false);

  const onDeleteProject = async () => {
    actionError.value = '';
    deletingProject.value = true;

    try {
      await projects.remove(projectId.value);
      await navigateTo('/projects');
    } catch (error) {
      actionError.value =
        (error as { message?: string }).message || 'Failed to delete the project.';
      deletingProject.value = false;
    }
  };

  const APP_STATUS: Record<
    ApplicationStatus,
    { label: string; variant: 'neutral' | 'success' | 'warning' | 'danger' | 'info' }
  > = {
    created: { label: 'Created', variant: 'neutral' },
    deploying: { label: 'Deploying', variant: 'info' },
    running: { label: 'Running', variant: 'success' },
    stopped: { label: 'Stopped', variant: 'warning' },
    failed: { label: 'Failed', variant: 'danger' },
  };

  // --- Environments ---------------------------------------------------------------------------------

  const newEnvironment = ref('');
  const addingEnvironment = ref(false);

  const addEnvironment = async () => {
    if (!newEnvironment.value.trim()) {
      return;
    }

    actionError.value = '';
    addingEnvironment.value = true;

    try {
      await projects.createEnvironment(projectId.value, newEnvironment.value.trim());
      newEnvironment.value = '';
      await refresh();
    } catch (error) {
      actionError.value =
        (error as { message?: string }).message || 'Failed to create environment.';
    } finally {
      addingEnvironment.value = false;
    }
  };

  const removeEnvironment = async (environmentId: string) => {
    actionError.value = '';

    try {
      await projects.removeEnvironment(projectId.value, environmentId);
      await refresh();
    } catch (error) {
      actionError.value =
        (error as { message?: string }).message || 'Failed to remove environment.';
    }
  };

  const renamingEnvironment = ref('');
  const renameValue = ref('');
  const renamingBusy = ref(false);

  const startRenameEnvironment = (environment: { id: string; name: string }) => {
    actionError.value = '';
    renamingEnvironment.value = environment.id;
    renameValue.value = environment.name;
  };

  const saveRenameEnvironment = async () => {
    if (!renameValue.value.trim()) {
      return;
    }

    actionError.value = '';
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
      actionError.value =
        (error as { message?: string }).message || 'Failed to rename environment.';
    } finally {
      renamingBusy.value = false;
    }
  };

  // --- New application ----------------------------------------------------------------------------

  const addingApp = ref(false);

  const appForm = useForm(
    z.object({
      name: z.string().trim().min(1, 'Enter a name'),
      environmentId: z.string().min(1, 'Choose an environment'),
      serverId: z.string().min(1, 'Choose a server'),
      repository: z
        .string()
        .trim()
        .regex(/^[^/\s]+\/[^/\s]+$/, 'Use the owner/repository format'),
      branch: z.string().trim().min(1),
      dockerfilePath: z.string().trim().min(1),
      port: z.string().regex(/^\d+$/, 'Invalid port'),
      autoDeploy: z.boolean(),
      token: z.string().trim(),
    }),
    {
      name: '',
      environmentId: '',
      serverId: '',
      repository: '',
      branch: 'main',
      dockerfilePath: 'Dockerfile',
      port: '3000',
      autoDeploy: true,
      token: '',
    },
  );

  const environmentOptions = computed(() =>
    environments.value.map(environment => ({ value: environment.id, label: environment.name })),
  );
  const serverOptions = computed(() =>
    serverList.value.map(server => ({ value: server.id, label: server.name })),
  );

  const openAddApp = () => {
    appForm.reset();
    appForm.values.environmentId = environments.value[0]?.id ?? '';
    appForm.values.serverId = serverList.value[0]?.id ?? '';
    addingApp.value = true;
  };

  const onCreateApp = appForm.submit(async values => {
    const { application } = await applications.create({
      name: values.name,
      environmentId: values.environmentId,
      serverId: values.serverId,
      port: Number(values.port),
      git: {
        host: 'github',
        repository: values.repository,
        branch: values.branch,
        dockerfilePath: values.dockerfilePath,
        buildContext: '.',
        autoDeploy: values.autoDeploy,
        // Only sent for private repositories; the backend stores it encrypted.
        token: values.token || undefined,
      },
    });

    addingApp.value = false;
    await navigateTo(`/applications/${application.id}`);
  });
</script>

<template>
  <section class="mx-auto flex max-w-4xl flex-col gap-6">
    <NuxtLink
      to="/projects"
      class="flex items-center gap-1 text-sm text-content-muted hover:text-content"
    >
      <Icon name="lucide:chevron-left" class="size-4" />
      Projects
    </NuxtLink>

    <header v-if="data" class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1>{{ data.project.name }}</h1>
        <p v-if="data.project.description" class="mt-1 text-sm text-content-muted">
          {{ data.project.description }}
        </p>
      </div>

      <UiButton v-if="canManage" variant="ghost" type="button" @click="openEditProject">
        Edit
      </UiButton>
    </header>

    <UiAlert v-if="actionError" variant="error">{{ actionError }}</UiAlert>

    <UiCard v-if="editingProject" title="Edit project">
      <form class="flex flex-col gap-4" @submit.prevent="onSaveProject">
        <UiAlert v-if="projectForm.formError.value" variant="error">{{
          projectForm.formError.value
        }}</UiAlert>

        <UiInput
          v-model="projectForm.values.name"
          label="Name"
          :error="projectForm.errors.value.name"
        />
        <UiTextarea v-model="projectForm.values.description" label="Description" :rows="3" />

        <div class="flex items-center justify-end gap-2">
          <UiButton variant="ghost" type="button" @click="editingProject = false">Cancel</UiButton>
          <UiButton type="submit" :loading="projectForm.submitting.value">Save</UiButton>
        </div>
      </form>
    </UiCard>

    <!-- Environments -->
    <UiCard title="Environments">
      <ul class="flex flex-col divide-y divide-surface-border">
        <li
          v-for="environment in environments"
          :key="environment.id"
          class="flex items-center justify-between gap-2 py-2"
        >
          <template v-if="renamingEnvironment === environment.id">
            <div class="flex flex-1 items-center gap-2">
              <UiInput v-model="renameValue" class="flex-1" @keyup.enter="saveRenameEnvironment" />
              <UiButton
                variant="secondary"
                type="button"
                :loading="renamingBusy"
                @click="saveRenameEnvironment"
              >
                Save
              </UiButton>
              <UiButton variant="ghost" type="button" @click="renamingEnvironment = ''">
                Cancel
              </UiButton>
            </div>
          </template>

          <template v-else>
            <span class="text-sm">{{ environment.name }}</span>
            <div v-if="canManage" class="flex items-center gap-1">
              <button
                type="button"
                title="Rename environment"
                class="rounded-lg p-1.5 text-content-muted transition-colors hover:text-content"
                @click="startRenameEnvironment(environment)"
              >
                <Icon name="lucide:pencil" class="size-4" />
              </button>
              <button
                v-if="environments.length > 1"
                type="button"
                title="Remove environment"
                class="rounded-lg p-1.5 text-content-muted transition-colors hover:text-danger"
                @click="removeEnvironment(environment.id)"
              >
                <Icon name="lucide:trash-2" class="size-4" />
              </button>
            </div>
          </template>
        </li>
      </ul>

      <form v-if="canManage" class="mt-3 flex gap-2" @submit.prevent="addEnvironment">
        <div class="flex-1">
          <UiInput v-model="newEnvironment" placeholder="staging" />
        </div>
        <UiButton type="submit" variant="secondary" :loading="addingEnvironment">Add</UiButton>
      </form>
    </UiCard>

    <!-- Applications -->
    <UiCard title="Applications">
      <template #header>
        <div class="flex items-center justify-between">
          <h2>Applications</h2>
          <UiButton v-if="canManage && !addingApp" @click="openAddApp">
            <Icon name="lucide:plus" class="size-4" />
            New application
          </UiButton>
        </div>
      </template>

      <form
        v-if="addingApp"
        class="mb-5 flex flex-col gap-4 rounded-lg border border-surface-border p-4"
        @submit.prevent="onCreateApp"
      >
        <UiAlert v-if="appForm.formError.value" variant="error">
          {{ appForm.formError.value }}
        </UiAlert>

        <div class="grid gap-4 sm:grid-cols-2">
          <UiInput
            v-model="appForm.values.name"
            label="Name"
            placeholder="api"
            :error="appForm.errors.value.name"
          />
          <UiInput
            v-model="appForm.values.repository"
            label="Repository (GitHub)"
            placeholder="owner/repository"
            :error="appForm.errors.value.repository"
          />
          <UiSelect
            v-model="appForm.values.environmentId"
            label="Environment"
            :options="environmentOptions"
            :error="appForm.errors.value.environmentId"
          />
          <UiSelect
            v-model="appForm.values.serverId"
            label="Server"
            :options="serverOptions"
            :error="appForm.errors.value.serverId"
          />
          <UiInput v-model="appForm.values.branch" label="Branch" />
          <UiInput v-model="appForm.values.dockerfilePath" label="Dockerfile" />
          <UiInput v-model="appForm.values.port" label="Port" :error="appForm.errors.value.port" />
        </div>

        <UiInput
          v-model="appForm.values.token"
          label="Access token (private repository)"
          type="password"
          placeholder="Leave blank if the repository is public"
          hint="GitHub Personal Access Token with repository read access. Stored encrypted."
        />

        <UiCheckbox v-model="appForm.values.autoDeploy" label="Auto-deploy on every push" />

        <p v-if="!serverOptions.length" class="text-xs text-warning">
          Register a server before creating applications.
        </p>

        <div class="flex justify-end gap-2">
          <UiButton variant="ghost" type="button" @click="addingApp = false">Cancel</UiButton>
          <UiButton
            type="submit"
            :loading="appForm.submitting.value"
            :disabled="!serverOptions.length"
          >
            Create application
          </UiButton>
        </div>
      </form>

      <p v-if="!apps.length" class="text-sm text-content-muted">No applications in this project.</p>

      <ul v-else class="flex flex-col divide-y divide-surface-border">
        <li v-for="app in apps" :key="app.id">
          <NuxtLink
            :to="`/applications/${app.id}`"
            class="flex items-center gap-3 py-3 transition-colors hover:text-primary"
          >
            <Icon name="lucide:box" class="size-5 shrink-0 text-content-muted" />
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium">{{ app.name }}</p>
              <p class="truncate text-xs text-content-muted">{{ app.git.repository }}</p>
            </div>
            <UiBadge :variant="APP_STATUS[app.status].variant">
              {{ APP_STATUS[app.status].label }}
            </UiBadge>
          </NuxtLink>
        </li>
      </ul>
    </UiCard>

    <UiCard v-if="canManage && data" title="Danger zone">
      <div class="flex items-center justify-between gap-4">
        <p class="text-sm text-content-muted">
          Deletes this project, its environments and every application inside it. This cannot be
          undone.
        </p>
        <UiButton variant="danger" @click="confirmDeleteProjectOpen = true">
          Delete project
        </UiButton>
      </div>
    </UiCard>

    <UiConfirm
      :open="confirmDeleteProjectOpen"
      title="Delete project"
      :message="`Delete “${data?.project.name}”? ${apps.length} application(s) and ${environments.length} environment(s) are removed too. This cannot be undone.`"
      confirm-label="Delete"
      danger
      :loading="deletingProject"
      @confirm="onDeleteProject"
      @update:open="value => (confirmDeleteProjectOpen = value)"
    />
  </section>
</template>
