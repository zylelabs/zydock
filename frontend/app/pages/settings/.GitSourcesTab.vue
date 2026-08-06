<script setup lang="ts">
  import { z } from 'zod';
  import {
    useGitSources,
    type GitInstallation,
    type GitSource,
  } from '~/composables/services/useGitSources';
  import type { Organization } from '~/stores/organization.store';

  const props = defineProps<{ organization: Organization; canManage: boolean }>();

  const toast = useToast();
  const {
    list: listGitSources,
    startManifest,
    listInstallations,
    remove: removeGitSource,
  } = useGitSources();

  const emptyGitSources = { items: [], total: 0, page: 1, size: 0, pages: 0 };

  const {
    data: gitSourcesData,
    refresh: refreshGitSources,
    status: gitSourcesStatus,
    error: gitSourcesLoadError,
  } = await useAsyncData(
    () => `settings-git-sources-${props.organization.id}`,
    () => listGitSources(),
    { server: false, default: () => emptyGitSources },
  );

  const gitSources = computed(() => gitSourcesData.value?.items ?? []);
  const gitSourcesError = computed(
    () =>
      (gitSourcesLoadError.value as { message?: string } | null)?.message ||
      (gitSourcesLoadError.value ? 'Could not load the git sources.' : ''),
  );

  type InstallationState = { loading: boolean; items: GitInstallation[]; error: string };

  const installationsBySource = reactive<Record<string, InstallationState>>({});

  const loadInstallations = async (gitSourceId: string) => {
    installationsBySource[gitSourceId] = { loading: true, items: [], error: '' };

    try {
      const { items } = await listInstallations(gitSourceId);
      installationsBySource[gitSourceId] = { loading: false, items, error: '' };
    } catch (error) {
      installationsBySource[gitSourceId] = {
        loading: false,
        items: [],
        error: (error as { message?: string }).message || 'Could not load installations.',
      };
    }
  };

  watch(
    gitSources,
    sources => {
      for (const source of sources) {
        if (source.status === 'active' && !installationsBySource[source.id]) {
          loadInstallations(source.id);
        }
      }
    },
    { immediate: true },
  );

  const connectOpen = ref(false);

  const connectForm = useSchemaForm(
    z.object({
      name: z.string().trim().min(1, 'Enter a name'),
      organization: z.string().trim().optional(),
    }),
    { name: '', organization: '' },
    {
      onError: message => toast.error({ title: 'Error', message }),
      onInvalid: (_errors, lastError) => toast.error({ title: 'Error', message: lastError }),
    },
  );

  const openConnect = () => {
    connectForm.reset();
    connectOpen.value = true;
  };

  const submitManifestForm = (postUrl: string, manifest: Record<string, unknown>) => {
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = postUrl;
    form.style.display = 'none';

    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = 'manifest';
    input.value = JSON.stringify(manifest);

    form.appendChild(input);
    document.body.appendChild(form);
    form.submit();
  };

  const handleConnect = connectForm.submit(async values => {
    const result = await startManifest({
      name: values.name,
      organization: values.organization || undefined,
    });

    connectOpen.value = false;
    submitManifestForm(result.postUrl, result.manifest);
  });

  const toRemoveSource = ref<GitSource | null>(null);
  const confirmRemoveSourceOpen = ref(false);
  const removingSource = ref(false);

  const askRemoveSource = (source: GitSource) => {
    toRemoveSource.value = source;
    confirmRemoveSourceOpen.value = true;
  };

  const runRemoveSource = async () => {
    if (!toRemoveSource.value) {
      return;
    }

    removingSource.value = true;

    try {
      await removeGitSource(toRemoveSource.value.id);
      await refreshGitSources();
      confirmRemoveSourceOpen.value = false;
      toRemoveSource.value = null;
    } catch (error) {
      toast.error({
        title: 'Error',
        message: (error as { message?: string }).message || 'Failed to remove the git source.',
      });
    } finally {
      removingSource.value = false;
    }
  };
</script>

<template>
  <div class="flex flex-col gap-4.5">
    <Card title="Git sources" description="Connect a GitHub App once, per organization.">
      <template v-if="canManage" #right>
        <Button theme="primary" size="xs" @click="openConnect">
          <Icon name="proicons:add" size="16" />
          Connect GitHub
        </Button>
      </template>

      <div v-if="gitSourcesStatus === 'pending'" class="flex flex-col gap-3">
        <Skeleton class="h-20 w-full rounded-card" />
        <Skeleton class="h-20 w-full rounded-card" />
      </div>

      <Alert v-else-if="gitSourcesError" theme="error">{{ gitSourcesError }}</Alert>

      <EmptyState
        v-else-if="!gitSources.length"
        title="No git source connected"
        description="Connect a GitHub App to create applications by picking a repository, without pasting a token."
      />

      <div v-else class="flex flex-col gap-3.5">
        <div
          v-for="source in gitSources"
          :key="source.id"
          class="overflow-hidden rounded-card border border-edge"
        >
          <div class="flex flex-wrap items-center gap-3 px-4.25 py-3.25">
            <h3 class="min-w-0 flex-1 truncate text-[14px] font-semibold text-ink">
              {{ source.name }}
            </h3>
            <Tag :color="source.status === 'active' ? 'live' : 'default'" class="capitalize">
              {{ source.status }}
            </Tag>
          </div>

          <Row v-if="source.status === 'pending'" as="div" class="flex items-center">
            <p class="text-[13px] text-ink-2">Waiting for the confirmation on GitHub.</p>
          </Row>

          <template v-else>
            <div
              v-if="installationsBySource[source.id]?.loading"
              class="border-t border-hairline p-3"
            >
              <Skeleton class="h-10 w-full" />
            </div>

            <Alert v-else-if="installationsBySource[source.id]?.error" theme="error" class="m-3">
              {{ installationsBySource[source.id]?.error }}
            </Alert>

            <Row
              v-else-if="!installationsBySource[source.id]?.items.length"
              as="div"
              class="flex items-center"
            >
              <p class="text-[13px] text-ink-2">No installation yet.</p>
            </Row>

            <Row
              v-for="installation in installationsBySource[source.id]?.items"
              :key="installation.id"
              as="div"
              class="flex items-center gap-2.5 text-[13px]"
            >
              <Icon
                :name="
                  installation.accountType === 'Organization' ? 'lucide:building-2' : 'lucide:user'
                "
                class="size-4 shrink-0 text-ink-2"
              />
              <span class="truncate">{{ installation.account }}</span>
              <Tag class="ml-auto shrink-0">
                {{
                  installation.repositorySelection === 'all'
                    ? 'all repositories'
                    : 'selected repositories'
                }}
              </Tag>
            </Row>
          </template>

          <Row v-if="canManage" as="div" class="flex items-center gap-2">
            <Button
              v-if="source.htmlUrl"
              theme="secondary"
              size="xs"
              :to="source.htmlUrl"
              target="_blank"
              rel="noopener"
            >
              <Icon name="lucide:external-link" class="size-3.5" />
              Install / manage on GitHub
            </Button>
            <Button theme="quiet" size="xs" @click="askRemoveSource(source)">
              <Icon name="lucide:trash-2" class="size-3.5" />
              Remove
            </Button>
          </Row>
        </div>
      </div>
    </Card>

    <Confirm
      v-if="toRemoveSource"
      v-model:open="confirmRemoveSourceOpen"
      title="Remove git source"
      :message="`Remove “${toRemoveSource.name}”? Applications using it must be removed first.`"
      confirm-label="Remove"
      danger
      :loading="removingSource"
      @confirm="runRemoveSource"
    />

    <Modal :open="connectOpen" @on-close-modal="connectOpen = false">
      <Card
        title="Connect GitHub"
        class="w-md max-w-full"
        close-button
        @on-close="connectOpen = false"
      >
        <form class="flex flex-col gap-1.5" @submit.prevent="handleConnect">
          <Input
            v-model="connectForm.values.name"
            label="App name"
            placeholder="zydock-acme"
            :call-error="connectForm.errors.value.name"
          />
          <Input
            v-model="connectForm.values.organization"
            label="GitHub org (optional)"
            placeholder="acme-corp"
            :call-error="connectForm.errors.value.organization"
          />

          <p class="py-3 text-caption text-ink-3">
            You'll be taken to GitHub to confirm the app. Leave the organization empty to create it
            under your personal account.
          </p>

          <div class="flex items-center justify-end gap-2">
            <Button theme="quiet" type="button" @click="connectOpen = false">Cancel</Button>
            <Button theme="primary" type="submit" :disabled="connectForm.loading.value">
              <Icon v-if="connectForm.loading.value" name="svg-spinners:tadpole" size="16" />
              Continue on GitHub
            </Button>
          </div>
        </form>
      </Card>
    </Modal>
  </div>
</template>
