<script setup lang="ts">
  import { mergeClasses } from '~/utils';

  type ButtonTheme = 'primary' | 'secondary' | 'danger' | 'accent' | 'ghost';

  const props = defineProps<{
    to?: string;
    class?: string;
    disabled?: boolean;
    type?: 'submit' | 'button' | 'reset';
    theme?: ButtonTheme;
  }>();

  const base =
    'inline-flex items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-default disabled:opacity-60';

  const themes: Record<ButtonTheme, string> = {
    primary:
      'bg-primary text-white ring-0 hover:bg-primary-600 active:bg-primary-700 disabled:hover:bg-primary focus-visible:outline-primary-300',
    secondary:
      'bg-surface-raised text-content-strong ring-1 ring-inset ring-field-border hover:bg-surface-hover disabled:hover:bg-surface-raised focus-visible:outline-primary-300',
    danger:
      'bg-red-600 text-white ring-0 hover:bg-red-700 active:bg-red-800 disabled:hover:bg-red-600 focus-visible:outline-red-300',
    accent:
      'bg-accent-300 text-surface ring-0 hover:bg-accent-400 active:bg-accent-500 disabled:hover:bg-accent-300 focus-visible:outline-accent-200',
    ghost:
      'bg-transparent text-content-muted ring-0 hover:bg-surface-hover hover:text-content-strong disabled:hover:bg-transparent focus-visible:outline-primary-300',
  };

  const buttonClass = computed(() =>
    mergeClasses(base, themes[props.theme ?? 'secondary'], props.class),
  );
</script>

<template>
  <template v-if="props.to && !props.disabled">
    <NuxtLink :class="buttonClass" :to="to" :disabled="disabled">
      <slot />
    </NuxtLink>
  </template>
  <template v-else>
    <button :class="buttonClass" :disabled="disabled" :type="type">
      <slot />
    </button>
  </template>
</template>
