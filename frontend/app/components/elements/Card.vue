<script setup lang="ts">
  defineProps<{
    title?: string;
    description?: string;
    headerClass?: string;
    /**
     * Class applied to the content..
     * @default "p-4"
     */
    contentClass?: string;
    mode?: 'transparent';
    noBackground?: boolean;
    titleCenter?: boolean;
    closeButton?: boolean;
  }>();

  const emit = defineEmits(['onClose']);

  const slots = useSlots();
</script>

<template>
  <div
    class="z-10"
    :class="{
      'bg-surface-raised backdrop-blur-sm border border-surface-border rounded-xl shadow-soft':
        mode !== 'transparent',
    }"
  >
    <div
      v-if="title"
      class="py-5 px-1 font-medium flex flex-col gap-3 sm:flex-row sm:items-center"
      :class="[
        mode !== 'transparent' &&
          !noBackground &&
          'px-5 border-b border-surface-line bg-surface-sunken rounded-t-xl',
        titleCenter && 'text-center',
        headerClass,
      ]"
    >
      <div class="min-w-0">
        <div class="text-lg sm:text-xl text-content-strong">
          {{ title }}
        </div>

        <div v-if="description" class="text-sm text-content-muted">
          {{ description }}
        </div>
      </div>

      <div v-if="slots.right" class="w-full sm:ml-auto sm:w-auto">
        <slot name="right" />
      </div>

      <button
        v-if="closeButton"
        type="button"
        class="ml-auto mb-auto rounded-lg p-1 text-content-muted transition-colors cursor-pointer select-none hover:bg-surface-hover hover:text-content-strong"
        aria-label="Fechar"
        @click="emit('onClose')"
      >
        <Icon name="lucide:x" class="size-4" />
      </button>

      <slot name="header" />
    </div>

    <div class="p-5" :class="contentClass">
      <slot />
    </div>

    <div
      v-if="slots.footer"
      class="p-5 flex"
      :class="[
        mode !== 'transparent' &&
          !noBackground &&
          'px-5 border-t border-surface-line bg-surface-sunken rounded-b-xl',
        titleCenter && 'text-center',
      ]"
    >
      <slot name="footer" />
    </div>
  </div>
</template>
