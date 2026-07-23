<script setup lang="ts">
  import { z } from 'zod';

  useHead({ title: 'Settings' });

  const { current, update } = useOrganizations();
  const canManage = computed(() => ['owner', 'admin'].includes(current.value?.role ?? ''));

  const form = useForm(
    z.object({
      name: z.string().trim().min(2, 'At least 2 characters'),
      logo: z.string().trim().max(2048).optional(),
      favicon: z.string().trim().max(2048).optional(),
      primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Invalid color'),
      secondaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Invalid color'),
    }),
    { name: '', logo: '', favicon: '', primaryColor: '#3b82f6', secondaryColor: '#22c55e' },
  );

  const saved = ref(false);

  // Fills the form with the current organization as soon as it becomes available.
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
      <h1>Settings</h1>
      <p class="mt-1 text-sm text-content-muted">Organization name and branding.</p>
    </header>

    <UiCard v-if="!current" title="Select an organization">
      <p class="text-sm text-content-muted">Choose or create an organization in the sidebar.</p>
    </UiCard>

    <UiCard v-else-if="!canManage" title="Branding">
      <p class="text-sm text-content-muted">
        Only administrators can change the organization settings.
      </p>
    </UiCard>

    <UiCard v-else title="Branding">
      <form class="flex flex-col gap-4" @submit.prevent="onSave">
        <UiAlert v-if="form.formError.value" variant="error">{{ form.formError.value }}</UiAlert>
        <UiAlert v-if="saved" variant="success">Settings saved.</UiAlert>

        <UiInput v-model="form.values.name" label="Name" :error="form.errors.value.name" />

        <div class="grid gap-4 sm:grid-cols-2">
          <UiInput
            v-model="form.values.logo"
            label="Logo URL"
            placeholder="https://…/logo.png"
            :error="form.errors.value.logo"
          />
          <UiInput
            v-model="form.values.favicon"
            label="Favicon URL"
            placeholder="https://…/favicon.ico"
            :error="form.errors.value.favicon"
          />
          <UiInput
            v-model="form.values.primaryColor"
            label="Primary color"
            type="color"
            :error="form.errors.value.primaryColor"
          />
          <UiInput
            v-model="form.values.secondaryColor"
            label="Secondary color"
            type="color"
            :error="form.errors.value.secondaryColor"
          />
        </div>

        <p class="text-xs text-content-muted">
          Color and name changes apply to the entire interface as soon as you save.
        </p>

        <div class="flex justify-end">
          <UiButton type="submit" :loading="form.submitting.value">Save</UiButton>
        </div>
      </form>
    </UiCard>
  </section>
</template>
