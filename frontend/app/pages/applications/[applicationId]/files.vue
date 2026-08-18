<script setup lang="ts">
  import { useApplications } from '~/composables/services/useApplications';
  import { useOrganizations } from '~/composables/services/useOrganizations';
  import { useServers } from '~/composables/services/useServers';
  import { useVolumeFiles, type VolumeFileEntry } from '~/composables/services/useVolumeFiles';
  import { formatBytes, formatRelativeTime } from '~/utils';

  const route = useRoute();
  const session = useSessionStore();
  const toast = useToast();
  const { current } = useOrganizations();

  const applications = useApplications();
  const servers = useServers();
  const filesApi = useVolumeFiles();

  const applicationId = computed(() => String(route.params.applicationId));
  const canManage = computed(() => ['owner', 'admin'].includes(current.value?.role ?? ''));

  const notifyError = (error: unknown, fallback: string) => {
    toast.error({ title: 'Error', message: (error as { message?: string }).message || fallback });
  };

  const { data: shell, status: shellStatus } = useLazyAsyncData(
    () => `application-${applicationId.value}-files-shell`,
    async () => {
      if (!session.organizationId) {
        return null;
      }

      const { application } = await applications.get(applicationId.value);
      const { server } = await servers.get(application.serverId);

      return {
        name: application.name,
        serverId: application.serverId,
        serverName: server.name,
        volumes: application.volumes ?? [],
      };
    },
    { server: false, watch: [() => session.organizationId, applicationId], default: () => null },
  );

  const shellFirstLoad = useFirstLoad(shellStatus);

  const selectedVolume = ref('');

  watch(
    shell,
    value => {
      if (value && !value.volumes.some(volume => volume.source === selectedVolume.value)) {
        selectedVolume.value = value.volumes[0]?.source ?? '';
      }
    },
    { immediate: true },
  );

  const volumeOptions = computed(
    () =>
      shell.value?.volumes.map(volume => ({ value: volume.source, label: volume.source })) ?? [],
  );

  const currentPath = ref('');

  watch(selectedVolume, () => {
    currentPath.value = '';
  });

  const breadcrumb = computed(() => {
    if (!currentPath.value) {
      return [];
    }

    const segments = currentPath.value.split('/');

    return segments.map((segment, index) => ({
      label: segment,
      path: segments.slice(0, index + 1).join('/'),
    }));
  });

  const entries = ref<VolumeFileEntry[]>([]);
  const entriesLoading = ref(false);

  const loadEntries = async () => {
    if (!shell.value || !selectedVolume.value) {
      entries.value = [];
      return;
    }

    entriesLoading.value = true;

    try {
      entries.value = await filesApi.list(
        shell.value.serverId,
        selectedVolume.value,
        currentPath.value,
      );
    } catch (error) {
      entries.value = [];
      notifyError(error, 'Failed to list the directory.');
    } finally {
      entriesLoading.value = false;
    }
  };

  watch([() => shell.value, selectedVolume, currentPath], loadEntries, { immediate: true });

  const openEntry = (entry: VolumeFileEntry) => {
    if (entry.type === 'directory') {
      currentPath.value = entry.path;
    }
  };

  const goToPath = (path: string) => {
    currentPath.value = path;
  };

  const columns = [
    { key: 'name', label: 'Name' },
    { key: 'sizeBytes', label: 'Size' },
    { key: 'modifiedAt', label: 'Modified' },
    { key: 'actions', label: '', class: 'text-right' },
  ];

  const busyPath = ref('');

  const handleDownload = async (entry: VolumeFileEntry) => {
    if (!shell.value) {
      return;
    }

    busyPath.value = `${entry.path}:download`;

    try {
      const blob = await filesApi.read(shell.value.serverId, selectedVolume.value, entry.path);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');

      anchor.href = url;
      anchor.download = entry.name;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      notifyError(error, 'Failed to download the file.');
    } finally {
      busyPath.value = '';
    }
  };

  const editingEntry = ref<VolumeFileEntry | null>(null);
  const editingContent = ref('');
  const editingLoading = ref(false);
  const editingSaving = ref(false);
  const editingError = ref('');

  const openEditor = async (entry: VolumeFileEntry) => {
    if (!shell.value) {
      return;
    }

    editingEntry.value = entry;
    editingContent.value = '';
    editingError.value = '';
    editingLoading.value = true;

    try {
      const blob = await filesApi.read(shell.value.serverId, selectedVolume.value, entry.path);
      editingContent.value = await blob.text();
    } catch (error) {
      editingError.value = (error as { message?: string }).message || 'Failed to read the file.';
    } finally {
      editingLoading.value = false;
    }
  };

  const closeEditor = () => {
    if (editingSaving.value) {
      return;
    }

    editingEntry.value = null;
  };

  const saveEditor = async () => {
    if (!shell.value || !editingEntry.value) {
      return;
    }

    editingSaving.value = true;
    editingError.value = '';

    try {
      await filesApi.write(
        shell.value.serverId,
        selectedVolume.value,
        editingEntry.value.path,
        editingContent.value,
      );
      editingEntry.value = null;
      await loadEntries();
    } catch (error) {
      editingError.value = (error as { message?: string }).message || 'Failed to save the file.';
    } finally {
      editingSaving.value = false;
    }
  };

  const removeTarget = ref<VolumeFileEntry | null>(null);
  const removing = ref(false);
  const removeError = ref('');

  const askRemove = (entry: VolumeFileEntry) => {
    removeError.value = '';
    removeTarget.value = entry;
  };

  const confirmRemove = async () => {
    if (!shell.value || !removeTarget.value) {
      return;
    }

    removing.value = true;
    removeError.value = '';

    try {
      await filesApi.remove(shell.value.serverId, selectedVolume.value, removeTarget.value.path);
      removeTarget.value = null;
      await loadEntries();
    } catch (error) {
      removeError.value = (error as { message?: string }).message || 'Failed to remove the path.';
    } finally {
      removing.value = false;
    }
  };

  const fileInput = ref<HTMLInputElement | null>(null);
  const dragging = ref(false);
  const uploading = ref(false);
  const uploadLabel = ref('');
  const uploadPercent = ref(0);

  const uploadFiles = async (files: FileList | File[]) => {
    if (!shell.value || !canManage.value) {
      return;
    }

    const list = Array.from(files);

    if (!list.length) {
      return;
    }

    uploading.value = true;

    try {
      for (const [index, file] of list.entries()) {
        uploadLabel.value =
          list.length > 1 ? `${file.name} (${index + 1}/${list.length})` : file.name;
        uploadPercent.value = 0;

        const targetPath = currentPath.value ? `${currentPath.value}/${file.name}` : file.name;

        await filesApi.upload(
          shell.value.serverId,
          selectedVolume.value,
          targetPath,
          file,
          percent => (uploadPercent.value = percent),
        );
      }

      await loadEntries();
    } catch (error) {
      notifyError(error, 'Failed to upload the file.');
    } finally {
      uploading.value = false;
      uploadLabel.value = '';
      uploadPercent.value = 0;
    }
  };

  const handleFileInputChange = (event: Event) => {
    const target = event.target as HTMLInputElement;

    if (target.files) {
      uploadFiles(target.files);
    }

    target.value = '';
  };

  const handleDrop = (event: DragEvent) => {
    dragging.value = false;

    if (event.dataTransfer?.files.length) {
      uploadFiles(event.dataTransfer.files);
    }
  };

  useHead(() => ({ title: `Files · ${shell.value?.name ?? 'Application'}` }));

  const { set: setNavbar } = useNavbar();

  watchEffect(() => {
    setNavbar({
      title: 'Files',
      context: shell.value?.name,
      back: `/applications/${applicationId.value}`,
    });
  });
</script>

<template>
  <Content>
    <div v-if="shellFirstLoad" class="flex flex-col gap-3">
      <Skeleton class="h-9 max-w-60" />
      <Skeleton class="h-70 rounded-card" />
    </div>

    <EmptyState
      v-else-if="!shell?.volumes.length"
      variant="action"
      title="No volumes"
      description="This application has no named volume, so there is nothing to browse."
    />

    <div v-else class="flex flex-col gap-3">
      <div class="flex flex-wrap items-center gap-2">
        <Select
          v-if="volumeOptions.length > 1"
          v-model="selectedVolume"
          :options="volumeOptions"
          boxed
          class="min-w-50"
        />
        <span v-else class="font-mono text-caption text-ink-2">{{ selectedVolume }}</span>

        <div class="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-caption text-ink-2">
          <button
            type="button"
            class="cursor-pointer rounded-control px-1.5 py-0.5 hover:bg-inset hover:text-ink"
            @click="goToPath('')"
          >
            <Icon name="lucide:home" class="size-3.5" />
          </button>
          <template v-for="(segment, index) in breadcrumb" :key="segment.path">
            <span class="text-ink-3">/</span>
            <button
              type="button"
              class="cursor-pointer truncate rounded-control px-1.5 py-0.5 hover:bg-inset hover:text-ink"
              :class="index === breadcrumb.length - 1 && 'font-medium text-ink'"
              @click="goToPath(segment.path)"
            >
              {{ segment.label }}
            </button>
          </template>
        </div>

        <template v-if="canManage">
          <input
            ref="fileInput"
            type="file"
            multiple
            class="hidden"
            @change="handleFileInputChange"
          />
          <Button theme="secondary" size="sm" :disabled="uploading" @click="fileInput?.click()">
            <Icon v-if="uploading" name="svg-spinners:tadpole" size="16" />
            Upload
          </Button>
        </template>
      </div>

      <Alert v-if="uploading" theme="info">
        Uploading {{ uploadLabel }} — {{ uploadPercent }}%
      </Alert>

      <div
        class="rounded-card"
        :class="dragging && 'ring-2 ring-accent ring-offset-2 ring-offset-page'"
        @dragover.prevent="canManage && (dragging = true)"
        @dragleave.prevent="dragging = false"
        @drop.prevent="canManage && handleDrop($event)"
      >
        <Table
          :columns="columns"
          :items="entries as unknown as Record<string, unknown>[]"
          grid-class="grid-cols-[1.6fr_0.6fr_0.8fr_auto]"
          :loading="entriesLoading"
          row-key="path"
          empty-label="This directory is empty."
        >
          <template #name="{ item }">
            <button
              v-if="(item as unknown as VolumeFileEntry).type === 'directory'"
              type="button"
              class="flex min-w-0 cursor-pointer items-center gap-2 hover:text-accent"
              @click="openEntry(item as unknown as VolumeFileEntry)"
            >
              <Icon name="lucide:folder" class="size-4 shrink-0 text-ink-2" />
              <span class="truncate font-mono text-caption text-ink">{{
                (item as unknown as VolumeFileEntry).name
              }}</span>
            </button>
            <div v-else class="flex min-w-0 items-center gap-2">
              <Icon name="lucide:file" class="size-4 shrink-0 text-ink-2" />
              <span class="truncate font-mono text-caption text-ink">{{
                (item as unknown as VolumeFileEntry).name
              }}</span>
              <Tag
                v-if="!(item as unknown as VolumeFileEntry).readableAsText"
                title="Too large or binary — download only"
              >
                binary
              </Tag>
            </div>
          </template>

          <template #sizeBytes="{ item }">
            <span class="text-caption text-ink-2">
              {{
                (item as unknown as VolumeFileEntry).type === 'directory'
                  ? '—'
                  : formatBytes((item as unknown as VolumeFileEntry).sizeBytes)
              }}
            </span>
          </template>

          <template #modifiedAt="{ item }">
            <span class="text-caption text-ink-2">{{
              formatRelativeTime((item as unknown as VolumeFileEntry).modifiedAt) ?? '—'
            }}</span>
          </template>

          <template #actions="{ item }">
            <div class="flex items-center justify-end gap-1">
              <button
                v-if="(item as unknown as VolumeFileEntry).type === 'file'"
                type="button"
                title="Download"
                class="cursor-pointer rounded-control p-1.5 text-ink-2 hover:bg-inset hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
                :disabled="busyPath === `${(item as unknown as VolumeFileEntry).path}:download`"
                @click="handleDownload(item as unknown as VolumeFileEntry)"
              >
                <Icon name="lucide:download" class="size-4" />
              </button>
              <button
                v-if="
                  canManage &&
                  (item as unknown as VolumeFileEntry).type === 'file' &&
                  (item as unknown as VolumeFileEntry).readableAsText
                "
                type="button"
                title="Edit"
                class="cursor-pointer rounded-control p-1.5 text-ink-2 hover:bg-inset hover:text-ink"
                @click="openEditor(item as unknown as VolumeFileEntry)"
              >
                <Icon name="lucide:pencil" class="size-4" />
              </button>
              <button
                v-if="canManage"
                type="button"
                title="Remove"
                class="cursor-pointer rounded-control p-1.5 text-ink-2 hover:bg-inset hover:text-failed"
                @click="askRemove(item as unknown as VolumeFileEntry)"
              >
                <Icon name="lucide:trash-2" class="size-4" />
              </button>
            </div>
          </template>
        </Table>
      </div>
    </div>

    <Modal :open="Boolean(editingEntry)" @on-close-modal="closeEditor">
      <Card
        :title="editingEntry?.path"
        class="w-3xl max-w-full"
        close-button
        @on-close="closeEditor"
      >
        <Alert theme="warning" class="mb-3.5">
          Saving only takes effect after the application restarts.
        </Alert>

        <Skeleton v-if="editingLoading" class="h-70 rounded-control" />
        <Input
          v-else
          v-model="editingContent"
          type="textarea"
          :rows="20"
          mono
          bare
          class="rounded-control border border-edge bg-inset px-3 py-2"
        />

        <Alert v-if="editingError" theme="error" class="mt-3.5">{{ editingError }}</Alert>

        <template #footer>
          <div class="ml-auto flex items-center gap-2">
            <Button theme="quiet" type="button" :disabled="editingSaving" @click="closeEditor">
              Cancel
            </Button>
            <Button
              theme="primary"
              type="button"
              :disabled="editingSaving || editingLoading"
              @click="saveEditor"
            >
              <Icon v-if="editingSaving" name="svg-spinners:tadpole" size="16" />
              Save
            </Button>
          </div>
        </template>
      </Card>
    </Modal>

    <Confirm
      :open="Boolean(removeTarget)"
      title="Remove path"
      :message="
        removeTarget?.type === 'directory'
          ? `Remove the directory “${removeTarget?.path}” and everything inside it? This cannot be undone.`
          : `Remove “${removeTarget?.path}”? This cannot be undone.`
      "
      confirm-label="Remove"
      danger
      :loading="removing"
      @update:open="value => !value && (removeTarget = null)"
      @confirm="confirmRemove"
    >
      <Alert v-if="removeError" theme="error" class="mt-3">{{ removeError }}</Alert>
    </Confirm>
  </Content>
</template>
