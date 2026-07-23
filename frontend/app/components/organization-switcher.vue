<script setup lang="ts">
  import { z } from 'zod';

  const { organizations, current, select, create } = useOrganizations();

  const dropdownOpen = ref(false);
  const creating = ref(false);

  const form = useForm(z.object({ name: z.string().trim().min(2, 'Ao menos 2 caracteres') }), {
    name: '',
  });

  const label = computed(() => current.value?.name ?? 'Selecione uma organização');

  const choose = (id: string) => {
    const organization = organizations.value.find(item => item.id === id);

    if (organization) {
      select(organization);
    }

    dropdownOpen.value = false;
  };

  const onCreate = form.submit(async data => {
    await create(data.name);

    form.reset();
    creating.value = false;
    dropdownOpen.value = false;
  });
</script>

<template>
  <div class="relative border-b border-surface-border">
    <button
      type="button"
      class="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-surface"
      @click="dropdownOpen = !dropdownOpen"
    >
      <span
        class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-white"
      >
        {{ label.charAt(0).toUpperCase() }}
      </span>
      <span class="min-w-0 flex-1">
        <span class="block truncate text-sm font-semibold">{{ label }}</span>
        <span v-if="current?.role" class="block text-xs text-content-muted capitalize">{{
          current.role
        }}</span>
      </span>
      <Icon name="lucide:chevrons-up-down" class="size-4 shrink-0 text-content-muted" />
    </button>

    <!-- Camada para fechar ao clicar fora. -->
    <div v-if="dropdownOpen" class="fixed inset-0 z-10" @click="dropdownOpen = false" />

    <div
      v-if="dropdownOpen"
      class="absolute inset-x-3 top-full z-20 mt-1 rounded-lg border border-surface-border bg-surface-raised p-1 shadow-xl"
    >
      <button
        v-for="organization in organizations"
        :key="organization.id"
        type="button"
        class="flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-surface"
        @click="choose(organization.id)"
      >
        <span class="truncate">{{ organization.name }}</span>
        <Icon
          v-if="organization.id === current?.id"
          name="lucide:check"
          class="size-4 shrink-0 text-primary"
        />
      </button>

      <p v-if="!organizations.length" class="px-3 py-2 text-xs text-content-muted">
        Você ainda não faz parte de nenhuma organização.
      </p>

      <div class="my-1 border-t border-surface-border" />

      <button
        type="button"
        class="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-content-muted transition-colors hover:bg-surface hover:text-content"
        @click="
          creating = true;
          dropdownOpen = false;
        "
      >
        <Icon name="lucide:plus" class="size-4" />
        Criar organização
      </button>

      <NuxtLink
        v-if="current"
        to="/team"
        class="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-content-muted transition-colors hover:bg-surface hover:text-content"
        @click="dropdownOpen = false"
      >
        <Icon name="lucide:users" class="size-4" />
        Gerenciar time
      </NuxtLink>
    </div>

    <UiModal
      v-model:open="creating"
      title="Criar organização"
      description="Um espaço para seus projetos, servidores e time."
    >
      <form class="flex flex-col gap-4" @submit.prevent="onCreate">
        <UiAlert v-if="form.formError.value" variant="error">{{ form.formError.value }}</UiAlert>

        <UiInput
          v-model="form.values.name"
          label="Nome"
          placeholder="Minha empresa"
          :error="form.errors.value.name"
        />

        <div class="flex justify-end gap-2">
          <UiButton variant="ghost" type="button" @click="creating = false">Cancelar</UiButton>
          <UiButton type="submit" :loading="form.submitting.value">Criar</UiButton>
        </div>
      </form>
    </UiModal>
  </div>
</template>
