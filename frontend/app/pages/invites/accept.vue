<script setup lang="ts">
  useHead({ title: 'Invite' });

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

      await load();
      select(organization);
      await navigateTo('/');
    } catch (failure) {
      acceptError.value =
        (failure as { message?: string }).message || 'Could not accept the invite.';
    } finally {
      accepting.value = false;
    }
  };
</script>

<template>
  <section class="mx-auto max-w-md py-16">
    <UiCard title="Invite">
      <div v-if="error" class="text-sm">
        <p class="text-danger">{{ error.message || 'Invalid or expired invite.' }}</p>
        <NuxtLink to="/" class="mt-3 inline-block text-primary hover:underline">
          Back to the app
        </NuxtLink>
      </div>

      <div v-else-if="preview" class="flex flex-col gap-4">
        <p class="text-sm">
          You have been invited to
          <span class="font-semibold">{{ preview.organization.name }}</span>
          as <span class="capitalize">{{ preview.role }}</span
          >.
        </p>

        <UiAlert v-if="acceptError" variant="error">{{ acceptError }}</UiAlert>

        <div class="flex justify-end gap-2">
          <NuxtLink
            to="/"
            class="inline-flex items-center rounded-lg px-4 py-2 text-sm text-content-muted hover:text-content"
          >
            Not now
          </NuxtLink>
          <UiButton :loading="accepting" @click="onAccept">Accept invite</UiButton>
        </div>
      </div>
    </UiCard>
  </section>
</template>
