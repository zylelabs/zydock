<script setup lang="ts">
  import { z } from 'zod';
  import { useOrganizations } from '~/composables/services/useOrganizations';
  import { useProjects } from '~/composables/services/useProjects';

  const toast = useToast();
  const session = useSessionStore();
  const { current } = useOrganizations();
  const { list, create } = useProjects();

  const canManage = computed(() => ['owner', 'admin'].includes(current.value?.role ?? ''));

  const empty = { items: [], total: 0, page: 1, size: 0, pages: 0 };

  const { data, refresh } = await useAsyncData(
    'projects',
    () => (session.organizationId ? list() : Promise.resolve(empty)),
    { server: false, watch: [() => session.organizationId], default: () => empty },
  );

  const projects = computed(() => data.value?.items ?? []);

  const creating = ref(false);

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

  const openCreate = () => {
    form.reset();
    creating.value = true;
  };

  const handleCreate = form.submit(async values => {
    const { project } = await create(values.name, values.description || undefined);

    creating.value = false;
    await refresh();
    await navigateTo(`/projects/${project.id}`);
  });
</script>

<template>
  <Content>
    <Header title="Projects" description="They group environments and applications.">
      <template #right>
        <Button v-if="current && canManage" theme="primary" class="my-auto" @click="openCreate">
          <Icon name="proicons:add" size="18" />
          New project
        </Button>
      </template>
    </Header>
    <div v-if="projects.length" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <NuxtLink
        v-for="project in projects"
        :key="project.id"
        :to="`/projects/${project.id}`"
        class="rounded-xl border border-surface-border bg-surface-raised p-4 shadow-soft backdrop-blur-sm transition-colors hover:border-field-border hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-300"
      >
        <div class="flex items-center gap-2">
          <Icon name="lucide:folder-git-2" class="size-5 shrink-0 text-primary-400" />
          <h3 class="min-w-0 truncate">{{ project.name }}</h3>
        </div>
        <p class="mt-1 line-clamp-2 text-sm text-content-muted">
          {{ project.description || 'No description.' }}
        </p>
      </NuxtLink>
    </div>
    <div
      v-else
      class="flex flex-col items-center gap-3 rounded-xl border border-dashed border-field-border bg-surface-sunken px-6 py-12 text-center"
    >
      <Icon name="lucide:folder-git-2" class="size-8 text-content-dim" />
      <div>
        <h3 class="text-content-strong">No projects yet</h3>
        <p class="mt-1 text-sm text-content-muted">
          Create a project to organize your applications.
        </p>
      </div>
      <Button v-if="current && canManage" theme="primary" class="mt-1" @click="openCreate">
        <Icon name="proicons:add" size="18" />
        New project
      </Button>
    </div>

    <Modal :open="creating" @on-close-modal="creating = false">
      <Card title="New project" class="w-md max-w-full" close-button @on-close="creating = false">
        <form class="flex flex-col gap-4" @submit.prevent="handleCreate">
          <Input
            v-model="form.values.name"
            label="Name"
            placeholder="my-project"
            :call-error="form.errors.value.name"
          />
          <Input v-model="form.values.description" label="Description (optional)" />

          <div class="flex justify-end gap-2">
            <Button theme="ghost" type="button" @click="creating = false">Cancel</Button>
            <Button theme="primary" type="submit" :disabled="form.loading.value">
              <Icon v-if="form.loading.value" name="svg-spinners:tadpole" size="16" />
              Create
            </Button>
          </div>
        </form>
      </Card>
    </Modal>
  </Content>
</template>
