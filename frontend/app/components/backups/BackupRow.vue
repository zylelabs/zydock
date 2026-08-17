<script setup lang="ts">
  import type { Backup, BackupStatus, BackupType } from '~/composables/services/useBackups';
  import { formatBytes, formatDuration } from '~/utils';

  defineProps<{ backup: Backup; canManage: boolean; busy: string }>();

  const emit = defineEmits<{
    download: [backup: Backup];
    restore: [backup: Backup];
    remove: [backup: Backup];
  }>();

  const TYPE_LABELS: Record<BackupType, string> = {
    database: 'Database',
    volume: 'Volume',
    configuration: 'Configuration',
  };

  const STATUS: Record<BackupStatus, { label: string; color: string }> = {
    running: { label: 'Running', color: 'default' },
    completed: { label: 'Completed', color: 'live' },
    failed: { label: 'Failed', color: 'failed' },
  };
</script>

<template>
  <Row as="div" class="grid-cols-[1.2fr_0.7fr_0.6fr_auto]">
    <div class="min-w-0 flex flex-wrap items-center gap-2">
      <span class="truncate font-mono text-caption text-ink">{{ backup.label }}</span>
      <Tag>{{ TYPE_LABELS[backup.type] }}</Tag>
      <Tag :color="STATUS[backup.status].color">{{ STATUS[backup.status].label }}</Tag>
      <Tag v-if="backup.restoreStatus === 'running'" color="attn">Restoring</Tag>
    </div>

    <div class="truncate text-caption text-ink-2">
      {{ formatBytes(backup.sizeBytes) }} · {{ formatDuration(backup.durationMs) }}
    </div>

    <div class="truncate text-caption text-failed">
      <template v-if="backup.error">{{ backup.error }}</template>
      <template v-else-if="backup.restoreError">Restore failed: {{ backup.restoreError }}</template>
    </div>

    <div class="flex flex-wrap items-center justify-end gap-1.5">
      <Button
        v-if="backup.status === 'completed'"
        theme="quiet"
        size="xs"
        :disabled="busy === `${backup.id}:download`"
        @click="emit('download', backup)"
      >
        <Icon v-if="busy === `${backup.id}:download`" name="svg-spinners:tadpole" size="14" />
        Download
      </Button>
      <Button
        v-if="canManage && backup.status === 'completed' && backup.type !== 'configuration'"
        theme="secondary"
        size="xs"
        :disabled="backup.restoreStatus === 'running' || busy === `${backup.id}:restore`"
        @click="emit('restore', backup)"
      >
        <Icon v-if="busy === `${backup.id}:restore`" name="svg-spinners:tadpole" size="14" />
        Restore
      </Button>
      <button
        v-if="canManage"
        type="button"
        title="Remove backup"
        class="cursor-pointer rounded-control p-1.5 text-ink-2 hover:bg-inset hover:text-failed"
        @click="emit('remove', backup)"
      >
        <Icon name="lucide:trash-2" class="size-4" />
      </button>
    </div>
  </Row>
</template>
