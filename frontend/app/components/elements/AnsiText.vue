<script setup lang="ts">
  const props = defineProps<{ text: string; class?: string }>();

  const segments = computed(() => parseAnsi(props.text));
</script>

<template>
  <span :class="props.class">
    <span v-for="(segment, index) in segments" :key="index" :style="segment.style">
      {{ segment.text }}
    </span>
  </span>
</template>
