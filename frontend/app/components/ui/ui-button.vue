<script setup lang="ts">
  type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

  const {
    variant = 'primary',
    type = 'button',
    loading = false,
    disabled = false,
    block = false,
  } = defineProps<{
    variant?: Variant;
    type?: 'button' | 'submit' | 'reset';
    loading?: boolean;
    disabled?: boolean;
    block?: boolean;
  }>();

  const VARIANTS: Record<Variant, string> = {
    primary: 'bg-primary text-white hover:bg-primary-strong',
    secondary:
      'border border-surface-border bg-surface-raised text-content hover:border-content-muted',
    ghost: 'text-content-muted hover:bg-surface-raised hover:text-content',
    danger: 'bg-danger text-white hover:opacity-90',
  };
</script>

<template>
  <button
    :type="type"
    :disabled="disabled || loading"
    :class="
      mergeClasses(
        'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60',
        VARIANTS[variant],
        block && 'w-full',
      )
    "
  >
    <Icon v-if="loading" name="lucide:loader-circle" class="size-4 animate-spin" />
    <slot />
  </button>
</template>
