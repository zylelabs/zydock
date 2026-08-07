<script setup lang="ts">
  withDefaults(defineProps<{ rows?: number }>(), { rows: 3 });
</script>

<template>
  <div class="rounded-card border border-edge bg-card p-4.25">
    <Skeleton class="mb-3.25 h-3.5 w-1/3" />
    <div class="flex flex-col gap-2.5">
      <Skeleton v-for="row in rows" :key="row" class="h-3 w-full" />
    </div>
  </div>
</template>
