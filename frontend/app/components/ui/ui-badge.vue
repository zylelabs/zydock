<script setup lang="ts">
  type Variant = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

  const { variant = 'neutral' } = defineProps<{ variant?: Variant }>();

  const VARIANTS: Record<Variant, string> = {
    neutral: 'bg-surface text-content-muted',
    success: 'bg-success/15 text-success',
    warning: 'bg-warning/15 text-warning',
    danger: 'bg-danger/15 text-danger',
    info: 'bg-primary/15 text-primary',
  };
</script>

<template>
  <span
    :class="
      mergeClasses(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
        VARIANTS[variant],
      )
    "
  >
    <slot />
  </span>
</template>
