<script setup lang="ts">
  defineProps<{ label: string; value: string; note?: string; bars?: number[]; sm?: boolean }>();
</script>

<template>
  <div class="rounded-card border border-edge bg-card px-4.25 py-3.75">
    <div class="text-caption text-ink-2">{{ label }}</div>
    <div class="my-1.5 flex items-baseline gap-2">
      <span :class="sm ? 'text-metric-sm' : 'text-metric'" class="text-ink">{{ value }}</span>
      <span v-if="note" class="text-caption text-ink-3">{{ note }}</span>
    </div>
    <div v-if="bars?.length" class="flex h-8.5 items-end gap-0.75">
      <div
        v-for="(bar, index) in bars"
        :key="index"
        class="flex-1 rounded-xs bg-accent-soft"
        :style="{ height: `${bar}%` }"
      />
    </div>
  </div>
</template>
