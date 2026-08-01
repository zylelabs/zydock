<script setup lang="ts">
  defineProps<{ vertical?: boolean }>();
</script>

<template>
  <div v-if="!vertical" class="w-full h-px bg-gray-200"></div>
  <div v-else class="w-px h-full bg-gray-200"></div>
</template>
