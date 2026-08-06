<script setup lang="ts">
  withDefaults(defineProps<{ rounded?: string }>(), { rounded: 'rounded' });
</script>

<template>
  <div class="animate-pulse bg-hairline" :class="rounded"></div>
</template>
