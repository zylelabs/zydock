<script setup lang="ts">
  const props = defineProps<{
    title: string;
    message: string;
    confirmLabel?: string;
    confirmText?: string;
    danger?: boolean;
    loading?: boolean;
  }>();

  const emit = defineEmits<{ confirm: [] }>();

  const open = defineModel<boolean>('open', { default: false });

  const typedText = ref('');

  const confirmDisabled = computed(
    () =>
      props.loading || (Boolean(props.confirmText) && typedText.value.trim() !== props.confirmText),
  );

  const handleClose = () => {
    if (props.loading) {
      return;
    }

    open.value = false;
  };

  watch(open, value => {
    if (!value) {
      typedText.value = '';
    }
  });
</script>

<template>
  <Modal :open="open" @on-close-modal="handleClose">
    <Card :title="title" class="w-[32rem] max-w-full" close-button @on-close="handleClose">
      <p class="text-sm text-ink-2">{{ message }}</p>

      <Input
        v-if="confirmText"
        v-model="typedText"
        class="mt-4"
        :label="`Type “${confirmText}” to confirm`"
        boxed
        bare
      />

      <template #footer>
        <div class="ml-auto flex items-center gap-2">
          <Button theme="quiet" type="button" :disabled="loading" @click="handleClose">
            Cancel
          </Button>
          <Button
            :theme="danger ? 'destructive' : 'primary'"
            type="button"
            :disabled="confirmDisabled"
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
