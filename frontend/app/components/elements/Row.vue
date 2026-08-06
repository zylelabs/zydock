<script setup lang="ts">
  import { mergeClasses } from '~/utils';

  const props = defineProps<{
    to?: string;
    class?: string;
    /**
     * Renders a plain `div` instead of a link/button, for rows that hold their own controls
     * (a button inside an anchor is invalid). The row stays fully clickable by giving the main
     * link `after:absolute after:inset-0`; controls opt out with `relative`.
     */
    as?: 'div';
  }>();

  const rowClass = computed(() =>
    mergeClasses(
      'grid w-full items-center gap-4.25 border-t border-hairline px-4.25 py-3.25 text-left first:border-t-0 hover:bg-row-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
      props.as === 'div' && 'relative',
      props.class,
    ),
  );
</script>

<template>
  <div v-if="as === 'div'" data-row :class="rowClass">
    <slot />
  </div>
  <NuxtLink v-else-if="to" :to="to" data-row :class="rowClass">
    <slot />
  </NuxtLink>
  <button v-else type="button" data-row :class="rowClass">
    <slot />
  </button>
</template>
