<script setup lang="ts">
  defineProps<{
    title: string;
    description: string;
    icon: string;
  }>();
</script>

<template>
  <section class="mx-auto flex max-w-md flex-col items-center gap-3 py-24 text-center">
    <span
      class="flex size-12 items-center justify-center rounded-xl border border-surface-border bg-surface-raised text-primary"
    >
      <Icon :name="icon" class="size-6" />
    </span>

    <h1>{{ title }}</h1>
    <p class="text-sm text-content-muted">{{ description }}</p>
  </section>
</template>
