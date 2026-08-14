<script setup lang="ts">
  type Variant = 'prompt' | 'action';

  const props = defineProps<{
    variant?: Variant;
    title?: string;
    description?: string;
    actionLabel?: string;
    centered?: boolean;
  }>();

  const emit = defineEmits<{ action: [] }>();

  const isPrompt = computed(() => (props.variant ?? 'prompt') === 'prompt');
</script>

<template>
  <div
    v-if="isPrompt"
    class="rounded-card border border-dashed border-edge-strong px-5.5 py-8.5 text-center text-caption text-ink-3"
  >
    <slot>{{ description }}</slot>
  </div>

  <div v-else-if="centered" class="mx-auto my-15 max-w-130 text-center">
    <Logo class="mx-auto mb-5 size-11.5" />
    <h1 class="mb-2 text-title text-ink">{{ title }}</h1>
    <p v-if="description" class="mb-6 text-body text-ink-2 text-pretty">
      {{ description }}
    </p>
    <div class="flex justify-center gap-2.5">
      <Button v-if="actionLabel" theme="primary" @click="emit('action')">{{ actionLabel }}</Button>
      <slot />
    </div>
  </div>

  <div v-else class="rounded-card border border-edge bg-card px-5.5 py-6.5">
    <div v-if="title" class="mb-1.5 text-heading text-ink">{{ title }}</div>
    <p v-if="description" class="mb-4 text-caption text-ink-2">
      {{ description }}
    </p>
    <Button v-if="actionLabel" theme="primary" size="sm" @click="emit('action')">{{
      actionLabel
    }}</Button>
    <slot />
  </div>
</template>
