<script setup lang="ts">
  import { useGitSources } from '~/composables/services/useGitSources';

  useHead({ title: 'Connecting GitHub' });

  const route = useRoute();
  const { completeManifest } = useGitSources();

  const status = ref<'loading' | 'error'>('loading');
  const errorMessage = ref('');

  onMounted(async () => {
    const code = String(route.query.code ?? '');
    const state = String(route.query.state ?? '');

    if (!code || !state) {
      status.value = 'error';
      errorMessage.value = 'The callback URL is missing the code or state from GitHub.';
      return;
    }

    try {
      await completeManifest({ code, state });
      await navigateTo('/settings?tab=git');
    } catch (error) {
      status.value = 'error';
      errorMessage.value =
        (error as { message?: string }).message || 'Could not complete the connection.';
    }
  });
</script>

<template>
  <Content>
    <Header title="Connecting GitHub" description="Finishing the GitHub App registration." />

    <Card title="Connecting GitHub" class="mx-auto w-md max-w-full">
      <div
        v-if="status === 'loading'"
        class="flex flex-col items-center gap-3 py-6 text-content-muted"
      >
        <Icon name="svg-spinners:tadpole" size="28" />
        <p class="text-sm">Finishing the connection…</p>
      </div>

      <template v-else>
        <Alert theme="error">{{ errorMessage }}</Alert>

        <div class="mt-4 flex justify-end">
          <Button theme="secondary" to="/settings?tab=git">Back to settings</Button>
        </div>
      </template>
    </Card>
  </Content>
</template>
