<script setup lang="ts">
  withDefaults(defineProps<{ label?: boolean }>(), { label: true });
</script>

<template>
  <div class="rounded-card border border-edge bg-card px-4.25 py-3.75">
    <Skeleton v-if="label" class="mb-2.5 h-3 w-1/3" />
    <Skeleton class="h-1.25 rounded-full" />
  </div>
</template>
