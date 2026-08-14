<script setup lang="ts">
  import {
    useGitSources,
    type GitInstallation,
    type GitRepository,
    type GitSource,
  } from '~/composables/services/useGitSources';

  export type GitSourceSelection = {
    gitSourceId: string;
    installationId: string;
    repository: string;
    defaultBranch: string;
  };

  const emit = defineEmits<{ select: [GitSourceSelection | null] }>();

  const session = useSessionStore();
  const { list: listGitSources, listInstallations, listRepositories } = useGitSources();

  const gitSources = ref<GitSource[]>([]);
  const gitSourcesLoading = ref(false);

  const loadGitSources = async () => {
    if (!session.organizationId) {
      gitSources.value = [];
      return;
    }

    gitSourcesLoading.value = true;

    try {
      const { items } = await listGitSources();
      gitSources.value = items.filter(source => source.status === 'active');
    } finally {
      gitSourcesLoading.value = false;
    }
  };

  onMounted(loadGitSources);
  watch(() => session.organizationId, loadGitSources);

  const gitSourceOptions = computed(() =>
    gitSources.value.map(source => ({ value: source.id, label: source.name })),
  );

  const selectedGitSourceId = ref('');
  const installations = ref<GitInstallation[]>([]);
  const installationsLoading = ref(false);
  const installationsError = ref('');

  const selectedInstallationId = ref('');
  const repositories = ref<GitRepository[]>([]);
  const repositoriesLoading = ref(false);
  const repositoriesError = ref('');

  const selectedRepository = ref('');
  const repositoryQuery = ref('');

  const filteredRepositories = computed(() => {
    const query = repositoryQuery.value.trim().toLowerCase();

    if (!query) {
      return repositories.value;
    }

    return repositories.value.filter(repository =>
      repository.fullName.toLowerCase().includes(query),
    );
  });

  const installationOptions = computed(() =>
    installations.value.map(installation => ({
      value: installation.id,
      label: `${installation.account} (${installation.accountType})`,
    })),
  );

  const loadInstallations = async (gitSourceId: string) => {
    installations.value = [];
    installationsError.value = '';
    installationsLoading.value = true;

    try {
      const { items } = await listInstallations(gitSourceId);
      installations.value = items;
    } catch (error) {
      installationsError.value =
        (error as { message?: string }).message || 'Could not load installations.';
    } finally {
      installationsLoading.value = false;
    }
  };

  const loadRepositories = async (gitSourceId: string, installationId: string) => {
    repositories.value = [];
    repositoriesError.value = '';
    repositoriesLoading.value = true;

    try {
      const { items } = await listRepositories(gitSourceId, installationId);
      repositories.value = items;
    } catch (error) {
      repositoriesError.value =
        (error as { message?: string }).message || 'Could not load repositories.';
    } finally {
      repositoriesLoading.value = false;
    }
  };

  watch(selectedGitSourceId, gitSourceId => {
    selectedInstallationId.value = '';
    selectedRepository.value = '';
    installations.value = [];
    repositories.value = [];
    installationsError.value = '';

    if (gitSourceId) {
      loadInstallations(gitSourceId);
    }
  });

  watch(selectedInstallationId, installationId => {
    selectedRepository.value = '';
    repositories.value = [];
    repositoriesError.value = '';
    repositoryQuery.value = '';

    if (installationId && selectedGitSourceId.value) {
      loadRepositories(selectedGitSourceId.value, installationId);
    }
  });

  watch(selectedRepository, repository => {
    const found = repositories.value.find(candidate => candidate.fullName === repository);

    if (!repository || !found) {
      emit('select', null);
      return;
    }

    emit('select', {
      gitSourceId: selectedGitSourceId.value,
      installationId: selectedInstallationId.value,
      repository: found.fullName,
      defaultBranch: found.defaultBranch,
    });
  });

  defineExpose({
    reset: () => {
      selectedGitSourceId.value = '';
      selectedInstallationId.value = '';
      selectedRepository.value = '';
      repositoryQuery.value = '';
    },
  });
</script>

<template>
  <div class="flex flex-col gap-3.5">
    <div v-if="gitSourcesLoading" class="flex items-center gap-1.75 py-1.5">
      <Skeleton class="h-3 w-33 shrink-0" />
      <Skeleton class="h-7 flex-1 rounded-control" />
    </div>

    <div
      v-else-if="!gitSources.length"
      class="flex flex-col gap-2 rounded-card border border-dashed border-edge-strong px-4 py-6 text-center text-caption text-ink-2"
    >
      <p>No git source connected for this organization.</p>
      <NuxtLink to="/settings?tab=git" class="text-accent hover:underline">
        Connect a GitHub App in Settings
      </NuxtLink>
    </div>

    <template v-else>
      <Select
        v-model="selectedGitSourceId"
        label="Git source"
        :options="gitSourceOptions"
        placeholder="Choose a git source"
        boxed
        bare
      />

      <div v-if="selectedGitSourceId" class="flex flex-col gap-1">
        <div v-if="installationsLoading" class="flex items-center gap-1.75 py-1.5">
          <Skeleton class="h-3 w-33 shrink-0" />
          <Skeleton class="h-7 flex-1 rounded-control" />
        </div>
        <Alert v-else-if="installationsError" theme="error">{{ installationsError }}</Alert>
        <p v-else-if="!installations.length" class="text-caption text-attn-ink">
          This source has no installation yet — install the App on GitHub first.
        </p>
        <Select
          v-else
          v-model="selectedInstallationId"
          label="Installation"
          :options="installationOptions"
          placeholder="Choose an installation"
          boxed
          bare
        />
      </div>

      <div v-if="selectedInstallationId" class="flex flex-col gap-1">
        <div v-if="repositoriesLoading" class="overflow-hidden rounded-card border border-edge">
          <div class="border-b border-hairline px-3.5 py-2.5">
            <Skeleton class="h-3.5 w-40" />
          </div>

          <div
            v-for="index in 4"
            :key="index"
            class="flex items-center gap-3 border-t border-hairline px-3.5 py-3 first:border-t-0"
          >
            <Skeleton rounded="rounded-control" class="size-5.5 shrink-0" />
            <div class="flex min-w-0 flex-1 flex-col gap-2">
              <Skeleton class="h-3.5 w-2/5" />
              <Skeleton class="h-3 w-3/5" />
            </div>
          </div>
        </div>
        <Alert v-else-if="repositoriesError" theme="error">{{ repositoriesError }}</Alert>
        <p v-else-if="!repositories.length" class="text-caption text-attn-ink">
          This installation has no accessible repository.
        </p>

        <div v-else class="overflow-hidden rounded-card border border-edge">
          <div class="border-b border-hairline px-3.5 py-2.5">
            <input
              v-model="repositoryQuery"
              type="text"
              placeholder="Search repositories"
              class="w-full bg-transparent text-caption text-ink outline-none placeholder:text-ink-3"
            />
          </div>

          <div class="max-h-72 overflow-y-auto">
            <button
              v-for="repository in filteredRepositories"
              :key="repository.id"
              type="button"
              class="flex w-full items-center gap-3 border-t border-hairline px-3.5 py-3 text-left first:border-t-0 hover:bg-row-hover"
              :class="selectedRepository === repository.fullName && 'bg-accent-soft/15'"
              @click="selectedRepository = repository.fullName"
            >
              <div class="size-5.5 shrink-0 rounded-control bg-inset" />
              <div class="min-w-0 flex-1">
                <div class="truncate font-mono text-caption font-medium text-ink">
                  {{ repository.fullName }}
                </div>
                <div class="text-caption text-ink-2">
                  {{ repository.private ? 'private' : 'public' }} · default branch
                  {{ repository.defaultBranch }}
                </div>
              </div>
              <Icon
                v-if="selectedRepository === repository.fullName"
                name="lucide:check"
                class="size-4 shrink-0 text-accent"
              />
            </button>

            <p v-if="!filteredRepositories.length" class="px-3.5 py-3 text-caption text-ink-3">
              No repository found.
            </p>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
