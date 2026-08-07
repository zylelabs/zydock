<script setup lang="ts">
  withDefaults(defineProps<{ avatar?: boolean; trailingWidth?: string }>(), {
    avatar: false,
    trailingWidth: '4.5rem',
  });
</script>

<template>
  <div class="flex items-center gap-3.5 border-t border-hairline px-4.25 py-3.75 first:border-t-0">
    <Skeleton v-if="avatar" rounded="rounded-full" class="size-8 shrink-0" />
    <div class="flex min-w-0 flex-1 flex-col gap-2">
      <Skeleton class="h-3.5 w-2/5" />
      <Skeleton class="h-3 w-3/5" />
    </div>
    <Skeleton class="h-6 shrink-0" :style="{ width: trailingWidth }" />
  </div>
</template>
