<script setup lang="ts">
  const props = defineProps<{
    title: string;
    message: string;
    confirmLabel?: string;
    danger?: boolean;
    loading?: boolean;
  }>();

  const emit = defineEmits<{ confirm: [] }>();

  const open = defineModel<boolean>('open', { default: false });

  const handleClose = () => {
    if (props.loading) {
      return;
    }

    open.value = false;
  };
</script>

<template>
  <Modal :open="open" @on-close-modal="handleClose">
    <Card :title="title" class="w-[32rem] max-w-full" close-button @on-close="handleClose">
      <p class="text-sm text-content-muted">{{ message }}</p>

      <template #footer>
        <div class="ml-auto flex items-center gap-2">
          <Button theme="ghost" type="button" :disabled="loading" @click="handleClose">
            Cancel
          </Button>
          <Button
            :theme="danger ? 'danger' : 'primary'"
            type="button"
            :disabled="loading"
            @click="emit('confirm')"
          >
            <Icon v-if="loading" name="svg-spinners:tadpole" size="16" />
            {{ confirmLabel ?? 'Confirm' }}
          </Button>
        </div>
      </template>
    </Card>
  </Modal>
</template>
