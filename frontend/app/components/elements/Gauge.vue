<script setup lang="ts">
  const props = defineProps<{ label?: string; value?: string; percent: number }>();

  const isAttn = computed(() => props.percent > 60);

  const width = computed(() => `${Math.min(100, Math.max(0, props.percent))}%`);
</script>

<template>
  <div>
    <div
      v-if="label || value"
      class="mb-1.5 flex items-center justify-between text-caption text-ink-2"
    >
      <span>{{ label }}</span>
      <span>{{ value }}</span>
    </div>
    <div class="h-1.25 overflow-hidden rounded-full bg-hairline">
      <div
        class="h-full rounded-full transition-[width]"
        :class="isAttn ? 'bg-attn' : 'bg-accent'"
        :style="{ width }"
      />
    </div>
  </div>
</template>
