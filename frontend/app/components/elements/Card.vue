<script setup lang="ts">
  defineProps<{
    title?: string;
    description?: string;
    headerClass?: string;
    /**
     * Class applied to the content..
     * @default "p-4.25"
     */
    contentClass?: string;
    /**
     * Content is a list of grouped rows (`Row`, `Input`, `Select`): drops the content padding and
     * lets each row carry its own, so the dividers run from edge to edge.
     */
    rows?: boolean;
    titleCenter?: boolean;
    closeButton?: boolean;
  }>();

  const emit = defineEmits(['onClose']);

  const slots = useSlots();
</script>

<template>
  <div class="overflow-hidden rounded-card border border-edge bg-card shadow-raised">
    <div
      v-if="title"
      class="flex flex-col gap-3 border-b border-hairline px-4.25 py-3.25 sm:flex-row sm:items-center"
      :class="[titleCenter && 'text-center', headerClass]"
    >
      <div class="min-w-0">
        <div class="text-[13px] font-semibold text-ink">
          {{ title }}
        </div>

        <div v-if="description" class="text-caption text-ink-2">
          {{ description }}
        </div>
      </div>

      <div v-if="slots.right" class="w-full sm:ml-auto sm:w-auto">
        <slot name="right" />
      </div>

      <button
        v-if="closeButton"
        type="button"
        class="ml-auto mb-auto cursor-pointer rounded-control p-1 text-ink-2 transition-colors select-none hover:bg-inset hover:text-ink"
        aria-label="Fechar"
        @click="emit('onClose')"
      >
        <Icon name="lucide:x" class="size-4" />
      </button>

      <slot name="header" />
    </div>

    <div
      :data-rows="rows || undefined"
      :class="[rows ? 'p-0' : 'p-4.25 has-[>[data-row]]:p-0', contentClass]"
    >
      <slot />
    </div>

    <div
      v-if="slots.footer"
      class="flex border-t border-hairline px-4.25 py-3.25"
      :class="titleCenter && 'text-center'"
    >
      <slot name="footer" />
    </div>
  </div>
</template>
