<script setup lang="ts">
  import { z } from 'zod';

  useHead({ title: 'Configurações' });

  const { current, update } = useOrganizations();
  const canManage = computed(() => ['owner', 'admin'].includes(current.value?.role ?? ''));

  const form = useForm(
    z.object({
      name: z.string().trim().min(2, 'Ao menos 2 caracteres'),
      logo: z.string().trim().max(2048).optional(),
      favicon: z.string().trim().max(2048).optional(),
      primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida'),
      secondaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida'),
    }),
    { name: '', logo: '', favicon: '', primaryColor: '#3b82f6', secondaryColor: '#22c55e' },
  );

  const saved = ref(false);

  // Preenche o formulário com a organização atual assim que ela estiver disponível.
  watch(
    current,
    organization => {
      if (organization) {
        form.values.name = organization.name;
        form.values.logo = organization.branding.logo ?? '';
        form.values.favicon = organization.branding.favicon ?? '';
        form.values.primaryColor = organization.branding.primaryColor ?? '#3b82f6';
        form.values.secondaryColor = organization.branding.secondaryColor ?? '#22c55e';
      }
    },
    { immediate: true },
  );

  const onSave = form.submit(async values => {
    if (!current.value) {
      return;
    }

    saved.value = false;

    await update(current.value.id, {
      name: values.name,
      branding: {
        logo: values.logo || undefined,
        favicon: values.favicon || undefined,
        primaryColor: values.primaryColor,
        secondaryColor: values.secondaryColor,
      },
    });

    saved.value = true;
  });
</script>

<template>
  <section class="mx-auto flex max-w-2xl flex-col gap-6">
    <header>
      <h1>Configurações</h1>
      <p class="mt-1 text-sm text-content-muted">Nome e personalização da organização.</p>
    </header>

    <UiCard v-if="!current" title="Selecione uma organização">
      <p class="text-sm text-content-muted">Escolha ou crie uma organização na barra lateral.</p>
    </UiCard>

    <UiCard v-else-if="!canManage" title="Personalização">
      <p class="text-sm text-content-muted">
        Apenas administradores podem alterar as configurações da organização.
      </p>
    </UiCard>

    <UiCard v-else title="Personalização">
      <form class="flex flex-col gap-4" @submit.prevent="onSave">
        <UiAlert v-if="form.formError.value" variant="error">{{ form.formError.value }}</UiAlert>
        <UiAlert v-if="saved" variant="success">Configurações salvas.</UiAlert>

        <UiInput v-model="form.values.name" label="Nome" :error="form.errors.value.name" />

        <div class="grid gap-4 sm:grid-cols-2">
          <UiInput
            v-model="form.values.logo"
            label="URL do logo"
            placeholder="https://…/logo.png"
            :error="form.errors.value.logo"
          />
          <UiInput
            v-model="form.values.favicon"
            label="URL do favicon"
            placeholder="https://…/favicon.ico"
            :error="form.errors.value.favicon"
          />
          <UiInput
            v-model="form.values.primaryColor"
            label="Cor primária"
            type="color"
            :error="form.errors.value.primaryColor"
          />
          <UiInput
            v-model="form.values.secondaryColor"
            label="Cor secundária"
            type="color"
            :error="form.errors.value.secondaryColor"
          />
        </div>

        <p class="text-xs text-content-muted">
          As mudanças de cor e nome valem para a interface inteira assim que você salva.
        </p>

        <div class="flex justify-end">
          <UiButton type="submit" :loading="form.submitting.value">Salvar</UiButton>
        </div>
      </form>
    </UiCard>
  </section>
</template>
