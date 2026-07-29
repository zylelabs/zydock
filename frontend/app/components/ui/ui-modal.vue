<script setup lang="ts">
  const { title = '', description = '' } = defineProps<{ title?: string; description?: string }>();

  const open = defineModel<boolean>('open', { default: false });

  const close = () => {
    open.value = false;
  };

  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      close();
    }
  };

  watch(open, isOpen => {
    if (import.meta.client) {
      document.addEventListener('keydown', onKeydown);
      document.body.style.overflow = isOpen ? 'hidden' : '';

      if (!isOpen) {
        document.removeEventListener('keydown', onKeydown);
      }
    }
  });

  onBeforeUnmount(() => {
    if (import.meta.client) {
      document.removeEventListener('keydown', onKeydown);
      document.body.style.overflow = '';
    }
  });
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center p-4"
      @click.self="close"
    >
      <div class="absolute inset-0 bg-black/60" />

      <div
        class="relative w-full max-w-md rounded-xl border border-surface-border bg-surface-overlay p-6 shadow-xl"
      >
        <header v-if="title || description" class="mb-4">
          <h2 v-if="title">{{ title }}</h2>
          <p v-if="description" class="mt-1 text-sm text-content-muted">{{ description }}</p>
        </header>

        <slot />

        <footer v-if="$slots.footer" class="mt-6 flex justify-end gap-2">
          <slot name="footer" :close="close" />
        </footer>
      </div>
    </div>
  </Teleport>
</template>
