<script setup lang="ts">
  import type { NavbarAction } from '~/composables/useNavbar';

  defineProps<{
    title?: string;
    context?: string;
    loading?: boolean;
    action?: NavbarAction;
  }>();
</script>

<template>
  <header class="flex h-15 shrink-0 items-center gap-4 border-b border-edge px-7">
    <div class="min-w-0">
      <div v-if="context" class="truncate text-[11.5px] text-ink-3">{{ context }}</div>
      <div class="truncate text-heading text-ink">{{ title }}</div>
    </div>

    <div class="flex-1" />

    <Icon v-if="loading" name="svg-spinners:tadpole" class="text-ink-2" size="16" />

    <Button
      v-if="action"
      :theme="action.theme ?? 'primary'"
      size="sm"
      :disabled="action.loading"
      @click="action.onClick"
    >
      <Icon v-if="action.loading" name="svg-spinners:tadpole" size="16" />
      <Icon v-else-if="action.icon" :name="action.icon" size="16" />
      {{ action.label }}
    </Button>
  </header>
</template>
