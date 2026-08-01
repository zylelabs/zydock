<script setup lang="ts">
  withDefaults(defineProps<{ rounded?: string }>(), { rounded: 'rounded' });
</script>

<template>
  <div class="animate-pulse bg-gray-200" :class="rounded"></div>
</template>
