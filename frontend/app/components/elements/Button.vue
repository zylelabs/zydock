<script setup lang="ts">
  import { mergeClasses } from '~/utils';

  type ButtonTheme = 'primary' | 'secondary' | 'quiet' | 'destructive';
  type LegacyButtonTheme = 'danger' | 'accent' | 'ghost';
  type ButtonSize = 'md' | 'sm' | 'xs';

  const props = defineProps<{
    to?: string;
    class?: string;
    disabled?: boolean;
    type?: 'submit' | 'button' | 'reset';
    theme?: ButtonTheme | LegacyButtonTheme;
    size?: ButtonSize;
  }>();

  const legacyThemes: Record<LegacyButtonTheme, ButtonTheme> = {
    danger: 'destructive',
    accent: 'quiet',
    ghost: 'quiet',
  };

  const base =
    'inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50';

  const themes: Record<ButtonTheme, string> = {
    primary: 'bg-ink text-page hover:opacity-90',
    secondary: 'border border-edge-strong bg-card hover:bg-inset',
    quiet: 'text-ink-2 hover:text-ink',
    destructive: 'border border-failed/40 bg-card text-failed hover:bg-failed/5',
  };

  const sizes: Record<ButtonSize, string> = {
    md: 'rounded-[10px] px-5 py-[11px] text-body',
    sm: 'rounded-[9px] px-3.5 py-[7px] text-caption',
    xs: 'rounded-control px-[11px] py-[5px] text-caption',
  };

  const resolvedTheme = computed<ButtonTheme>(
    () =>
      legacyThemes[props.theme as LegacyButtonTheme] ?? (props.theme as ButtonTheme) ?? 'secondary',
  );

  const buttonClass = computed(() =>
    mergeClasses(base, themes[resolvedTheme.value], sizes[props.size ?? 'md'], props.class),
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
