<script setup lang="ts">
  const {
    label = '',
    placeholder = '',
    error = '',
    hint = '',
    rows = 4,
    id = useId(),
  } = defineProps<{
    label?: string;
    placeholder?: string;
    error?: string;
    hint?: string;
    rows?: number;
    id?: string;
  }>();

  const model = defineModel<string>({ default: '' });
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <label v-if="label" :for="id" class="text-sm font-medium text-content">{{ label }}</label>

    <textarea
      :id="id"
      v-model="model"
      :rows="rows"
      :placeholder="placeholder"
      :aria-invalid="Boolean(error)"
      :class="
        mergeClasses(
          'resize-y rounded-lg border bg-surface px-3 py-2 font-mono text-xs text-content transition-colors placeholder:text-content-muted focus:outline-none focus:ring-2 focus:ring-primary/40',
          error ? 'border-danger' : 'border-surface-border focus:border-primary',
        )
      "
    />

    <p v-if="error" class="text-xs text-danger">{{ error }}</p>
    <p v-else-if="hint" class="text-xs text-content-muted">{{ hint }}</p>
  </div>
</template>
