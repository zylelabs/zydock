<script setup lang="ts">
  import type { VolumeWorkspaceOpenFile } from '~/composables/useVolumeWorkspace';

  const props = defineProps<{
    openFiles: VolumeWorkspaceOpenFile[];
    activePath: string;
    canManage: boolean;
    saving: boolean;
  }>();

  const emit = defineEmits<{
    activate: [path: string];
    close: [path: string];
    revert: [path: string];
    save: [path: string];
    download: [path: string];
    'update:content': [path: string, content: string];
  }>();

  const active = computed(() => props.openFiles.find(file => file.path === props.activePath));

  const isDirty = (file: VolumeWorkspaceOpenFile) => file.content !== file.original;

  const lineCount = computed(() => (active.value ? active.value.content.split('\n').length : 0));

  const gutterLines = computed(() =>
    Array.from({ length: lineCount.value }, (_, index) => index + 1),
  );

  const gutter = ref<HTMLElement | null>(null);
  const textarea = ref<HTMLTextAreaElement | null>(null);

  const syncScroll = () => {
    if (gutter.value && textarea.value) {
      gutter.value.scrollTop = textarea.value.scrollTop;
    }
  };

  const handleInput = (event: Event) => {
    if (active.value) {
      emit('update:content', active.value.path, (event.target as HTMLTextAreaElement).value);
    }
  };
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col overflow-clip rounded-card border border-edge bg-card">
    <div
      v-if="openFiles.length"
      class="sticky top-0 z-10 flex items-stretch overflow-x-auto border-b border-edge bg-card"
    >
      <button
        v-for="file in openFiles"
        :key="file.path"
        type="button"
        class="flex shrink-0 cursor-pointer items-center gap-2 border-r border-edge px-3.5 py-2 font-mono text-caption whitespace-nowrap"
        :class="
          file.path === activePath
            ? 'bg-card text-ink shadow-[inset_0_2px_0_0_var(--color-accent)]'
            : 'text-ink-2 hover:bg-inset'
        "
        @click="emit('activate', file.path)"
      >
        <span
          v-if="isDirty(file)"
          class="size-1.5 shrink-0 rounded-full bg-accent"
          title="Unsaved changes"
        ></span>
        <span class="truncate">{{ file.name }}</span>
        <Icon
          name="lucide:x"
          class="size-3.5 shrink-0 text-ink-3 hover:text-ink"
          @click.stop="emit('close', file.path)"
        />
      </button>
    </div>

    <EmptyState
      v-if="!active"
      variant="prompt"
      description="Select a file to edit."
      class="m-4 flex-1 border-none"
    />

    <template v-else>
      <EmptyState v-if="!active.readableAsText" variant="prompt" class="m-4 flex-1 border-none">
        <p>This file is binary or too large to edit here.</p>
        <Button theme="secondary" size="sm" class="mt-3" @click="emit('download', active.path)">
          <Icon name="lucide:download" class="size-4" />
          Download
        </Button>
      </EmptyState>

      <Skeleton v-else-if="active.loading" class="m-3 flex-1 rounded-control" />

      <div v-else-if="active.error" class="p-3.5">
        <Alert theme="error">{{ active.error }}</Alert>
      </div>

      <div v-else class="flex min-h-0 flex-1 overflow-hidden">
        <div
          ref="gutter"
          class="select-none overflow-hidden bg-card px-3 py-2 text-right font-mono text-caption text-ink-3"
        >
          <div v-for="line in gutterLines" :key="line">{{ line }}</div>
        </div>
        <textarea
          ref="textarea"
          class="min-w-0 flex-1 resize-none bg-card px-3 py-2 font-mono text-caption text-ink outline-none"
          spellcheck="false"
          :value="active.content"
          @input="handleInput"
          @scroll="syncScroll"
        ></textarea>
      </div>

      <div
        v-if="active.readableAsText && !active.loading && !active.error"
        class="sticky bottom-0 z-10 flex items-center justify-between border-t border-edge bg-card px-3.5 py-2"
      >
        <span class="font-mono text-caption text-ink-2"
          >{{ active.path }} · {{ lineCount }} lines</span
        >
        <div class="flex items-center gap-2">
          <Button theme="quiet" size="sm" @click="emit('download', active.path)">
            <Icon name="lucide:download" class="size-4" />
            Download
          </Button>
          <Button
            theme="quiet"
            size="sm"
            :disabled="!isDirty(active)"
            @click="emit('revert', active.path)"
          >
            Revert
          </Button>
          <Button
            theme="primary"
            size="sm"
            :disabled="!canManage || !isDirty(active) || saving"
            @click="emit('save', active.path)"
          >
            <Icon v-if="saving" name="svg-spinners:tadpole" size="16" />
            Save
          </Button>
        </div>
      </div>
    </template>
  </div>
</template>
