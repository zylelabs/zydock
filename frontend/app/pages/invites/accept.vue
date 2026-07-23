<script setup lang="ts">
  useHead({ title: 'Convite' });

  const route = useRoute();
  const { previewInvite, acceptInvite } = useTeam();
  const { load, select } = useOrganizations();

  const organizationId = computed(() => String(route.query.organization ?? ''));
  const token = computed(() => String(route.query.token ?? ''));

  const { data: preview, error } = await useAsyncData(
    'invite-preview',
    () =>
      organizationId.value && token.value
        ? previewInvite(organizationId.value, token.value)
        : Promise.resolve(null),
    { server: false },
  );

  const accepting = ref(false);
  const acceptError = ref('');

  const onAccept = async () => {
    accepting.value = true;
    acceptError.value = '';

    try {
      const { organization } = await acceptInvite(organizationId.value, token.value);

      // Reload the list (the user now belongs to one more) and land already inside it.
      await load();
      select(organization);
      await navigateTo('/');
    } catch (failure) {
      acceptError.value = (failure as { message?: string }).message || 'Não foi possível aceitar.';
    } finally {
      accepting.value = false;
    }
  };
</script>

<template>
  <section class="mx-auto max-w-md py-16">
    <UiCard title="Convite">
      <div v-if="error" class="text-sm">
        <p class="text-danger">{{ error.message || 'Convite inválido ou expirado.' }}</p>
        <NuxtLink to="/" class="mt-3 inline-block text-primary hover:underline">
          Voltar à interface
        </NuxtLink>
      </div>

      <div v-else-if="preview" class="flex flex-col gap-4">
        <p class="text-sm">
          Você foi convidado para
          <span class="font-semibold">{{ preview.organization.name }}</span>
          como <span class="capitalize">{{ preview.role }}</span
          >.
        </p>

        <UiAlert v-if="acceptError" variant="error">{{ acceptError }}</UiAlert>

        <div class="flex justify-end gap-2">
          <NuxtLink
            to="/"
            class="inline-flex items-center rounded-lg px-4 py-2 text-sm text-content-muted hover:text-content"
          >
            Agora não
          </NuxtLink>
          <UiButton :loading="accepting" @click="onAccept">Aceitar convite</UiButton>
        </div>
      </div>
    </UiCard>
  </section>
</template>
