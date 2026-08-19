<script setup lang="ts">
  import type { Application } from '~/composables/services/useApplications';
  import type { VolumeFileEntry } from '~/composables/services/useVolumeFiles';
  import { useVolumeWorkspace } from '~/composables/useVolumeWorkspace';

  const props = defineProps<{ application: Application; canManage: boolean }>();

  const toast = useToast();

  const notifyError = (error: unknown, fallback: string) => {
    toast.error({ title: 'Error', message: (error as { message?: string }).message || fallback });
  };

  const volumes = computed(() => props.application.volumes ?? []);
  const volumeOptions = computed(() =>
    volumes.value.map(volume => ({ value: volume.source, label: volume.source })),
  );

  const selectedVolume = ref(volumes.value[0]?.source ?? '');

  watch(
    volumes,
    list => {
      if (!list.some(volume => volume.source === selectedVolume.value)) {
        selectedVolume.value = list[0]?.source ?? '';
      }
    },
    { immediate: true },
  );

  const serverId = computed(() => props.application.serverId);

  const workspace = useVolumeWorkspace(serverId, selectedVolume);

  const rootEntries = computed(() => workspace.tree.value.get('') ?? []);
  const rootLoading = computed(() => workspace.loadingDirs.value.has(''));

  const loadRoot = () => {
    if (selectedVolume.value) {
      workspace
        .refreshDirectory('')
        .catch(error => notifyError(error, 'Failed to list the volume.'));
    }
  };

  watch(selectedVolume, loadRoot, { immediate: true });

  const saving = ref(false);

  const handleSave = async (path: string) => {
    saving.value = true;

    try {
      await workspace.save(path);
    } finally {
      saving.value = false;
    }
  };

  const downloadingPath = ref('');

  const handleDownload = async (path: string, name: string) => {
    downloadingPath.value = path;

    try {
      await workspace.downloadFile(path, name);
    } catch (error) {
      notifyError(error, 'Failed to download the file.');
    } finally {
      downloadingPath.value = '';
    }
  };

  const fileInput = ref<HTMLInputElement | null>(null);
  const uploadDirectory = ref('');
  const uploading = ref(false);
  const uploadLabel = ref('');
  const uploadPercent = ref(0);

  const askUpload = (directory: string) => {
    uploadDirectory.value = directory;
    fileInput.value?.click();
  };

  const runUpload = async (directory: string, files: File[]) => {
    uploading.value = true;

    try {
      await workspace.uploadFiles(directory, files, (file, percent) => {
        uploadLabel.value = file.name;
        uploadPercent.value = percent;
      });
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
    const files = Array.from(target.files ?? []);

    target.value = '';

    if (files.length) {
      runUpload(uploadDirectory.value, files);
    }
  };

  const handleDropFiles = (directory: string, files: File[]) => {
    if (!uploading.value) {
      runUpload(directory, files);
    }
  };

  const removeTarget = ref<{ path: string; type: VolumeFileEntry['type'] } | null>(null);
  const removing = ref(false);
  const removeError = ref('');

  const askRemove = (entry: VolumeFileEntry) => {
    removeError.value = '';
    removeTarget.value = { path: entry.path, type: entry.type };
  };

  const askRemoveFile = (path: string) => {
    removeError.value = '';
    removeTarget.value = { path, type: 'file' };
  };

  const confirmRemove = async () => {
    if (!removeTarget.value) {
      return;
    }

    removing.value = true;
    removeError.value = '';

    try {
      await workspace.removePath(removeTarget.value.path);
      removeTarget.value = null;
    } catch (error) {
      removeError.value = (error as { message?: string }).message || 'Failed to remove the path.';
    } finally {
      removing.value = false;
    }
  };

  const closeTarget = ref('');

  const handleClose = (path: string) => {
    if (!workspace.closeFile(path)) {
      closeTarget.value = path;
    }
  };

  const confirmClose = () => {
    workspace.forceCloseFile(closeTarget.value);
    closeTarget.value = '';
  };

  const downloadActive = (path: string) => {
    handleDownload(path, path.split('/').pop() ?? path);
  };
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <Select
        v-if="volumeOptions.length > 1"
        v-model="selectedVolume"
        :options="volumeOptions"
        boxed
        class="min-w-50"
      />
      <span v-else class="font-mono text-caption text-ink-2">{{ selectedVolume }}</span>

      <template v-if="canManage">
        <input
          ref="fileInput"
          type="file"
          multiple
          class="hidden"
          @change="handleFileInputChange"
        />
        <Button
          theme="secondary"
          size="sm"
          class="ml-auto"
          :disabled="uploading"
          @click="askUpload('')"
        >
          <Icon v-if="uploading" name="svg-spinners:tadpole" size="16" />
          <Icon v-else name="lucide:upload" class="size-4" />
          Upload
        </Button>
      </template>
    </div>

    <Alert v-if="uploading" theme="info">Uploading {{ uploadLabel }} — {{ uploadPercent }}%</Alert>

    <div class="grid min-h-0 flex-1 gap-4.5 lg:grid-cols-[17rem_1fr]">
      <VolumeFileTree
        :entries="rootEntries"
        :tree="workspace.tree.value"
        :expanded="workspace.expanded.value"
        :loading="workspace.loadingDirs.value"
        :active-path="workspace.activePath.value"
        :can-manage="canManage"
        :busy-path="downloadingPath"
        :class="[
          'lg:sticky lg:top-0 lg:max-h-[calc(100dvh-4.5rem)] lg:self-start',
          rootLoading && 'opacity-60',
        ]"
        @toggle="workspace.toggleDirectory"
        @open="workspace.openFile"
        @download="entry => handleDownload(entry.path, entry.name)"
        @remove="askRemove"
        @upload="askUpload"
        @drop-files="handleDropFiles"
      />

      <VolumeFileEditor
        class="lg:min-h-[calc(100dvh-4.5rem)]"
        :open-files="workspace.openFiles.value"
        :active-path="workspace.activePath.value"
        :can-manage="canManage"
        :saving="saving"
        :busy-path="downloadingPath"
        @activate="path => (workspace.activePath.value = path)"
        @close="handleClose"
        @revert="workspace.revert"
        @save="handleSave"
        @download="downloadActive"
        @remove="askRemoveFile"
        @update:content="
          (path, content) => {
            const file = workspace.openFiles.value.find(item => item.path === path);
            if (file) {
              file.content = content;
            }
          }
        "
      />
    </div>

    <p class="text-caption text-ink-2">
      Saving writes to the volume. A running process only picks the file up on restart.
    </p>

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

    <Confirm
      :open="Boolean(closeTarget)"
      title="Discard changes"
      :message="`Discard unsaved changes in “${closeTarget}”?`"
      confirm-label="Discard"
      danger
      @update:open="value => !value && (closeTarget = '')"
      @confirm="confirmClose"
    />
  </div>
</template>
