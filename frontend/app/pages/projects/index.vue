<script setup lang="ts">
  import { z } from 'zod';

  useHead({ title: 'Projetos' });

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
      name: z.string().trim().min(1, 'Informe um nome'),
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
        <h1>Projetos</h1>
        <p class="mt-1 text-sm text-content-muted">Agrupam ambientes e aplicações.</p>
      </div>
      <UiButton v-if="current && canManage" @click="creating = true">
        <Icon name="lucide:plus" class="size-4" />
        Novo projeto
      </UiButton>
    </header>

    <UiCard v-if="!current" title="Selecione uma organização">
      <p class="text-sm text-content-muted">Escolha ou crie uma organização na barra lateral.</p>
    </UiCard>

    <UiCard v-else-if="!projects.length" title="Nenhum projeto ainda">
      <p class="text-sm text-content-muted">Crie um projeto para organizar suas aplicações.</p>
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
          {{ project.description || 'Sem descrição.' }}
        </p>
      </NuxtLink>
    </div>

    <UiModal v-model:open="creating" title="Novo projeto">
      <form class="flex flex-col gap-4" @submit.prevent="onCreate">
        <UiAlert v-if="form.formError.value" variant="error">{{ form.formError.value }}</UiAlert>
        <UiInput
          v-model="form.values.name"
          label="Nome"
          placeholder="loja-online"
          :error="form.errors.value.name"
        />
        <UiInput v-model="form.values.description" label="Descrição (opcional)" />
        <div class="flex justify-end gap-2">
          <UiButton variant="ghost" type="button" @click="creating = false">Cancelar</UiButton>
          <UiButton type="submit" :loading="form.submitting.value">Criar</UiButton>
        </div>
      </form>
    </UiModal>
  </section>
</template>
