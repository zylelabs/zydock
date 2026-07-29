<script setup lang="ts">
  defineProps<{
    title?: string;
    description?: string;
    flush?: boolean;
  }>();
</script>

<template>
  <section
    :class="
      mergeClasses(
        'rounded-xl border border-surface-border bg-surface-raised backdrop-blur-sm',
        flush ? 'overflow-hidden' : 'p-6',
      )
    "
  >
    <header
      v-if="title || description || $slots.header"
      :class="mergeClasses('mb-5', flush && 'mb-0 px-5 pt-5 pb-4')"
    >
      <slot name="header">
        <h2 v-if="title">{{ title }}</h2>
        <p v-if="description" class="mt-1 text-sm text-content-muted">{{ description }}</p>
      </slot>
    </header>

    <slot />
  </section>
</template>
