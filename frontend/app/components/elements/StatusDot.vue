<script setup lang="ts">
  /**
   * live: serving traffic, health check passing.
   * attn: work in progress, previous version still up.
   * stopped: the user stopped it, nothing is wrong.
   * failed: crashed or rolled back.
   */
  export type Status = 'live' | 'attn' | 'stopped' | 'failed';

  const props = defineProps<{ status: Status; class?: string }>();

  const colors: Record<Status, string> = {
    live: 'bg-live',
    attn: 'bg-attn',
    stopped: 'bg-stopped',
    failed: 'bg-failed',
  };
</script>

<template>
  <span class="inline-block size-2 shrink-0 rounded-full" :class="[colors[status], props.class]" />
</template>
