<script setup lang="ts">
  import type { VolumeFileEntry } from '~/composables/services/useVolumeFiles';
  import { formatBytes, formatRelativeTime } from '~/utils';

  const props = withDefaults(
    defineProps<{
      entries: VolumeFileEntry[];
      tree: Map<string, VolumeFileEntry[]>;
      expanded: Set<string>;
      loading: Set<string>;
      activePath: string;
      canManage: boolean;
      busyPath?: string;
      parent?: string;
      depth?: number;
    }>(),
    { busyPath: '', parent: '', depth: 0 },
  );

  const emit = defineEmits<{
    toggle: [path: string];
    open: [entry: VolumeFileEntry];
    download: [entry: VolumeFileEntry];
    remove: [entry: VolumeFileEntry];
    upload: [path: string];
    dropFiles: [path: string, files: File[]];
  }>();

  const indent = computed(() => `${props.depth * 1.25 + 0.625}rem`);

  const dragging = ref(false);
  const dragOverPath = ref('');

  const handleClick = (entry: VolumeFileEntry) => {
    if (entry.type === 'directory') {
      emit('toggle', entry.path);
      return;
    }

    emit('open', entry);
  };

  const detailsOf = (entry: VolumeFileEntry) => {
    const modified = formatRelativeTime(entry.modifiedAt);

    if (entry.type === 'directory') {
      return modified ? `${entry.path} · ${modified}` : entry.path;
    }

    return [entry.path, formatBytes(entry.sizeBytes), modified].filter(Boolean).join(' · ');
  };

  const filesOf = (event: DragEvent) => Array.from(event.dataTransfer?.files ?? []);

  const handleRowDrop = (entry: VolumeFileEntry, event: DragEvent) => {
    dragOverPath.value = '';

    const files = filesOf(event);

    if (props.canManage && files.length) {
      emit('dropFiles', entry.type === 'directory' ? entry.path : props.parent, files);
    }
  };

  const handleCardDrop = (event: DragEvent) => {
    dragging.value = false;

    const files = filesOf(event);

    if (props.canManage && files.length) {
      emit('dropFiles', '', files);
    }
  };
</script>

<template>
  <div
    v-if="depth === 0"
    class="flex flex-col overflow-hidden rounded-card border border-edge bg-card shadow-raised"
    :class="dragging && canManage && 'ring-2 ring-accent ring-offset-2 ring-offset-page'"
    @dragover.prevent="dragging = true"
    @dragleave.prevent="dragging = false"
    @drop.prevent="handleCardDrop"
  >
    <div class="flex shrink-0 items-center justify-between gap-2 border-b border-edge px-3 py-1.5">
      <span class="truncate font-mono text-caption text-ink-2">/</span>
      <button
        v-if="canManage"
        type="button"
        title="Upload to this directory"
        class="cursor-pointer rounded-control p-1 text-ink-2 hover:bg-inset hover:text-ink"
        @click="emit('upload', '')"
      >
        <Icon name="lucide:upload" class="size-3.5" />
      </button>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto py-1.5">
      <EmptyState
        v-if="entries.length === 0"
        variant="prompt"
        :description="
          canManage
            ? 'This directory is empty. Drop files here to upload.'
            : 'This directory is empty.'
        "
        class="mx-2 my-1 border-none px-0 py-2"
      />
      <VolumeFileTree
        v-else
        :entries="entries"
        :tree="tree"
        :expanded="expanded"
        :loading="loading"
        :active-path="activePath"
        :can-manage="canManage"
        :busy-path="busyPath"
        :depth="1"
        @toggle="emit('toggle', $event)"
        @open="emit('open', $event)"
        @download="emit('download', $event)"
        @remove="emit('remove', $event)"
        @upload="emit('upload', $event)"
        @drop-files="(path, files) => emit('dropFiles', path, files)"
      />
    </div>
  </div>

  <ul v-else class="flex flex-col">
    <template v-for="entry in entries" :key="entry.path">
      <li>
        <div
          class="group relative flex items-center rounded-control pr-1 hover:bg-inset"
          :class="[
            activePath === entry.path && 'bg-inset',
            dragOverPath === entry.path && canManage && 'ring-1 ring-accent',
          ]"
          :title="detailsOf(entry)"
          @dragover.prevent.stop="dragOverPath = entry.path"
          @dragleave.prevent.stop="dragOverPath = ''"
          @drop.prevent.stop="handleRowDrop(entry, $event)"
        >
          <button
            type="button"
            class="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 py-1 text-left font-mono text-caption"
            :class="
              activePath === entry.path
                ? 'text-ink'
                : entry.type === 'directory'
                  ? 'text-ink-2'
                  : 'text-ink-3'
            "
            :style="{ paddingLeft: indent }"
            @click="handleClick(entry)"
          >
            <Icon
              v-if="entry.type === 'directory'"
              name="lucide:chevron-right"
              class="size-3.5 shrink-0 transition-transform"
              :class="expanded.has(entry.path) && 'rotate-90'"
            />
            <span v-else class="size-3.5 shrink-0"></span>

            <span
              class="size-1.5 shrink-0 rounded-full"
              :class="entry.type === 'directory' ? 'bg-accent' : 'bg-ink-3'"
            ></span>

            <span class="truncate">{{ entry.name }}</span>
          </button>

          <span
            v-if="entry.type === 'file'"
            class="shrink-0 pl-2 font-mono text-caption text-ink-3 transition-opacity group-hover:opacity-0"
          >
            {{ formatBytes(entry.sizeBytes) }}
          </span>

          <div
            class="absolute top-1/2 right-1 flex -translate-y-1/2 items-center gap-0.5 rounded-control bg-inset opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
          >
            <button
              v-if="entry.type === 'directory' && canManage"
              type="button"
              title="Upload to this directory"
              class="cursor-pointer rounded-control p-1 text-ink-2 hover:text-ink"
              @click.stop="emit('upload', entry.path)"
            >
              <Icon name="lucide:upload" class="size-3.5" />
            </button>
            <button
              v-if="entry.type === 'file'"
              type="button"
              title="Download"
              class="cursor-pointer rounded-control p-1 text-ink-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
              :disabled="busyPath === entry.path"
              @click.stop="emit('download', entry)"
            >
              <Icon
                :name="busyPath === entry.path ? 'svg-spinners:tadpole' : 'lucide:download'"
                class="size-3.5"
              />
            </button>
            <button
              v-if="canManage"
              type="button"
              title="Remove"
              class="cursor-pointer rounded-control p-1 text-ink-2 hover:text-failed"
              @click.stop="emit('remove', entry)"
            >
              <Icon name="lucide:trash-2" class="size-3.5" />
            </button>
          </div>
        </div>

        <div v-if="entry.type === 'directory' && expanded.has(entry.path)">
          <Skeleton
            v-if="loading.has(entry.path)"
            class="mb-1 h-4"
            :style="{ marginLeft: `${(depth + 1) * 1.25 + 0.625}rem`, width: '60%' }"
          />
          <p
            v-else-if="(tree.get(entry.path) ?? []).length === 0"
            class="text-caption text-ink-3"
            :style="{ paddingLeft: `${(depth + 1) * 1.25 + 1.875}rem` }"
          >
            empty
          </p>
          <VolumeFileTree
            v-else
            :entries="tree.get(entry.path) ?? []"
            :tree="tree"
            :expanded="expanded"
            :loading="loading"
            :active-path="activePath"
            :can-manage="canManage"
            :busy-path="busyPath"
            :parent="entry.path"
            :depth="depth + 1"
            @toggle="emit('toggle', $event)"
            @open="emit('open', $event)"
            @download="emit('download', $event)"
            @remove="emit('remove', $event)"
            @upload="emit('upload', $event)"
            @drop-files="(path, files) => emit('dropFiles', path, files)"
          />
        </div>
      </li>
    </template>
  </ul>
</template>
