<script setup lang="ts">
  type Color = 'default' | 'green' | 'red' | 'blue' | 'purple' | 'orange' | 'yellow' | string;

  const props = defineProps<{ color?: Color }>();

  const colors = {
    default: 'bg-surface-hover text-content-strong ring-field-border',
    green: 'bg-green-500/12 text-green-300 ring-green-500/30',
    red: 'bg-red-500/12 text-red-300 ring-red-500/30',
    blue: 'bg-blue-500/12 text-blue-300 ring-blue-500/30',
    purple: 'bg-purple-500/12 text-purple-300 ring-purple-500/30',
    orange: 'bg-orange-500/12 text-orange-300 ring-orange-500/30',
    yellow: 'bg-yellow-500/12 text-yellow-300 ring-yellow-500/30',
  };

  const tagClass = computed(() => colors[props.color as keyof typeof colors] ?? colors.default);
</script>

<template>
  <span
    class="whitespace-nowrap inline-flex items-center text-xs px-2 py-1 rounded-md font-semibold ring-1 ring-inset cursor-default!"
    :class="tagClass"
  >
    <slot />
  </span>
</template>
