<script setup lang="ts">
  const { label = '' } = defineProps<{ label?: string }>();

  const model = defineModel<boolean>({ default: false });
</script>

<template>
  <label class="flex cursor-pointer items-center gap-2 text-sm text-content">
    <input
      v-model="model"
      type="checkbox"
      class="size-4 rounded border-surface-border bg-surface accent-primary"
    />
    <span v-if="label">{{ label }}</span>
    <slot />
  </label>
</template>
