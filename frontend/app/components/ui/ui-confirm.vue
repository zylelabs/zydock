<script setup lang="ts">
  // Confirmation dialog for destructive actions, built on `UiModal`. `v-model:open` controls it; it
  // emits `confirm` and shows `loading` on the action button so the caller can await the request.
  const {
    title,
    message,
    confirmLabel = 'Confirm',
    danger = false,
    loading = false,
  } = defineProps<{
    title: string;
    message: string;
    confirmLabel?: string;
    danger?: boolean;
    loading?: boolean;
  }>();

  const open = defineModel<boolean>('open', { default: false });

  const emit = defineEmits<{ confirm: [] }>();
</script>

<template>
  <UiModal v-model:open="open" :title="title" :description="message">
    <template #footer="{ close }">
      <UiButton variant="ghost" :disabled="loading" @click="close">Cancel</UiButton>
      <UiButton
        :variant="danger ? 'danger' : 'primary'"
        :loading="loading"
        @click="emit('confirm')"
      >
        {{ confirmLabel }}
      </UiButton>
    </template>
  </UiModal>
</template>
