<script setup lang="ts">
  const props = defineProps<{ open?: boolean }>();

  const emit = defineEmits(['onCloseModal']);

  const handleCloseModal = () => {
    emit('onCloseModal');
  };

  const panel = ref<HTMLElement | null>(null);

  let previouslyFocused: HTMLElement | null = null;

  const FOCUSABLE = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(', ');

  const focusableItems = () =>
    Array.from(panel.value?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
      element => element.getClientRects().length > 0,
    );

  const trapTab = (event: KeyboardEvent) => {
    const items = focusableItems();
    const first = items.at(0);
    const last = items.at(-1);

    if (!first || !last) {
      event.preventDefault();
      panel.value?.focus();
      return;
    }

    const active = document.activeElement as HTMLElement | null;
    const inside = !!active && !!panel.value?.contains(active);

    if (event.shiftKey && (!inside || active === first)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (!inside || active === last)) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleKeydown = (event: KeyboardEvent) => {
    if (!props.open) {
      return;
    }

    if (event.key === 'Escape') {
      handleCloseModal();
      return;
    }

    if (event.key === 'Tab') {
      trapTab(event);
    }
  };

  watch(
    () => props.open,
    async open => {
      if (open) {
        previouslyFocused = document.activeElement as HTMLElement | null;
        await nextTick();
        (focusableItems().at(0) ?? panel.value)?.focus();
        return;
      }

      previouslyFocused?.focus();
      previouslyFocused = null;
    },
  );

  onMounted(() => document.addEventListener('keydown', handleKeydown));

  onBeforeUnmount(() => document.removeEventListener('keydown', handleKeydown));
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="open">
        <div
          aria-hidden="true"
          class="z-50 fixed w-full h-full top-0 left-0 bg-black/60 backdrop-blur-sm"
          @click="handleCloseModal"
        ></div>

        <div
          ref="panel"
          role="dialog"
          aria-modal="true"
          tabindex="-1"
          class="panel fixed z-50 inset-0 flex items-center justify-center p-4 overflow-y-auto pointer-events-none focus:outline-none"
        >
          <div class="max-w-full max-h-[90dvh] overflow-y-auto pointer-events-auto">
            <slot />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
  .modal-enter-active,
  .modal-leave-active {
    transition: opacity 100ms ease;
  }

  .modal-enter-from,
  .modal-leave-to {
    opacity: 0;
  }

  .modal-enter-active .panel,
  .modal-leave-active .panel {
    transition: transform 100ms ease;
  }

  .modal-enter-from .panel,
  .modal-leave-to .panel {
    transform: scale(0.96);
  }

  @media (prefers-reduced-motion: reduce) {
    .modal-enter-active,
    .modal-leave-active,
    .modal-enter-active .panel,
    .modal-leave-active .panel {
      transition-duration: 1ms;
    }

    .modal-enter-from .panel,
    .modal-leave-to .panel {
      transform: none;
    }
  }
</style>
