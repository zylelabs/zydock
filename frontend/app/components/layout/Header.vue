<script setup lang="ts">
  defineProps<{ title: string; description?: string }>();

  const slots = useSlots();
</script>

<template>
  <div class="mb-8 flex">
    <div>
      <h1 class="text-2xl font-semibold text-white">{{ title }}</h1>
      <p class="text-sm text-white/80">{{ description }}</p>
    </div>
    <div v-if="slots.right" class="ml-auto flex">
      <slot name="right" />
    </div>
  </div>
</template>
