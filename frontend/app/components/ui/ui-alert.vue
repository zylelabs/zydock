<script setup lang="ts">
  type Variant = 'error' | 'success' | 'info';

  const { variant = 'info' } = defineProps<{ variant?: Variant }>();

  const VARIANTS: Record<Variant, { class: string; icon: string }> = {
    error: { class: 'border-danger/40 bg-danger/10 text-danger', icon: 'lucide:circle-alert' },
    success: { class: 'border-success/40 bg-success/10 text-success', icon: 'lucide:circle-check' },
    info: {
      class: 'border-surface-border bg-surface-raised text-content-muted',
      icon: 'lucide:info',
    },
  };
</script>

<template>
  <div
    role="alert"
    :class="
      mergeClasses(
        'flex items-start gap-2 rounded-lg border px-3 py-2 text-sm',
        VARIANTS[variant].class,
      )
    "
  >
    <Icon :name="VARIANTS[variant].icon" class="mt-0.5 size-4 shrink-0" />
    <span><slot /></span>
  </div>
</template>
