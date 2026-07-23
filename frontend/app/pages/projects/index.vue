<script setup lang="ts">
  import { z } from 'zod';

  useHead({ title: 'Projects' });

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
  const form = useForm(
    z.object({
      name: z.string().trim().min(1, 'Enter a name'),
      description: z.string().trim().max(500).optional(),
    }),
    { name: '', description: '' },
  );

  const onCreate = form.submit(async values => {
    const { project } = await create(values.name, values.description || undefined);
    creating.value = false;
    form.reset();
    await refresh();
    await navigateTo(`/projects/${project.id}`);
  });
</script>

<template>
  <section class="mx-auto flex max-w-4xl flex-col gap-6">
    <header class="flex items-center justify-between gap-4">
      <div>
        <h1>Projects</h1>
        <p class="mt-1 text-sm text-content-muted">They group environments and applications.</p>
      </div>
      <UiButton v-if="current && canManage" @click="creating = true">
        <Icon name="lucide:plus" class="size-4" />
        New project
      </UiButton>
    </header>

    <UiCard v-if="!current" title="Select an organization">
      <p class="text-sm text-content-muted">Choose or create an organization in the sidebar.</p>
    </UiCard>

    <UiCard v-else-if="!projects.length" title="No projects yet">
      <p class="text-sm text-content-muted">Create a project to organize your applications.</p>
    </UiCard>

    <div v-else class="grid gap-3 sm:grid-cols-2">
      <NuxtLink
        v-for="project in projects"
        :key="project.id"
        :to="`/projects/${project.id}`"
        class="rounded-xl border border-surface-border bg-surface-raised p-4 transition-colors hover:border-content-muted"
      >
        <div class="flex items-center gap-2">
          <Icon name="lucide:folder-git-2" class="size-5 text-primary" />
          <h3 class="truncate">{{ project.name }}</h3>
        </div>
        <p class="mt-1 line-clamp-2 text-sm text-content-muted">
          {{ project.description || 'No description.' }}
        </p>
      </NuxtLink>
    </div>

    <UiModal v-model:open="creating" title="New project">
      <form class="flex flex-col gap-4" @submit.prevent="onCreate">
        <UiAlert v-if="form.formError.value" variant="error">{{ form.formError.value }}</UiAlert>
        <UiInput
          v-model="form.values.name"
          label="Name"
          placeholder="my-project"
          :error="form.errors.value.name"
        />
        <UiInput v-model="form.values.description" label="Description (optional)" />
        <div class="flex justify-end gap-2">
          <UiButton variant="ghost" type="button" @click="creating = false">Cancel</UiButton>
          <UiButton type="submit" :loading="form.submitting.value">Create</UiButton>
        </div>
      </form>
    </UiModal>
  </section>
</template>
