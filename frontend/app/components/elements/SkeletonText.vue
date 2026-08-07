<script setup lang="ts">
  withDefaults(defineProps<{ lines?: number; lastLineWidth?: string }>(), {
    lines: 2,
    lastLineWidth: '60%',
  });
</script>

<template>
  <div class="flex flex-col gap-2">
    <Skeleton
      v-for="line in lines"
      :key="line"
      class="h-3.5"
      :style="line === lines ? { width: lastLineWidth } : undefined"
    />
  </div>
</template>
