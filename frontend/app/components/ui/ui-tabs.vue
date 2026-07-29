<script setup lang="ts">
  export interface TabItem {
    label: string;
    value: string;
    count?: number;
  }

  defineProps<{ items: TabItem[] }>();

  const model = defineModel<string>({ required: true });
</script>

<template>
  <div class="flex w-fit gap-0.5 rounded-lg border border-surface-line bg-surface-sunken p-1">
    <button
      v-for="item in items"
      :key="item.value"
      type="button"
      :class="
        mergeClasses(
          'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold whitespace-nowrap transition-colors',
          model === item.value
            ? 'bg-surface-hover text-content-strong'
            : 'text-content-muted hover:text-content',
        )
      "
      @click="model = item.value"
    >
      {{ item.label }}
      <span v-if="item.count !== undefined" class="text-xs font-medium text-content-dim">
        {{ item.count }}
      </span>
    </button>
  </div>
</template>
