<script setup lang="ts">
  defineProps<{
    title?: string;
    description?: string;
  }>();
</script>

<template>
  <section class="rounded-xl border border-surface-border bg-surface-raised p-6">
    <header v-if="title || description || $slots.header" class="mb-5">
      <slot name="header">
        <h2 v-if="title">{{ title }}</h2>
        <p v-if="description" class="mt-1 text-sm text-content-muted">{{ description }}</p>
      </slot>
    </header>

    <slot />
  </section>
</template>
