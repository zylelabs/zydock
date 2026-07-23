<script setup lang="ts">
  // A single field: label, control, hint and error. `v-model` binds the value; `error` (from the
  // form's validation) turns the border red and shows the message below.
  const {
    label = '',
    type = 'text',
    placeholder = '',
    error = '',
    hint = '',
    autocomplete = '',
    id = useId(),
  } = defineProps<{
    label?: string;
    type?: string;
    placeholder?: string;
    error?: string;
    hint?: string;
    autocomplete?: string;
    id?: string;
  }>();

  const model = defineModel<string>({ default: '' });
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <label v-if="label" :for="id" class="text-sm font-medium text-content">{{ label }}</label>

    <input
      :id="id"
      v-model="model"
      :type="type"
      :placeholder="placeholder"
      :autocomplete="autocomplete"
      :aria-invalid="Boolean(error)"
      :class="
        mergeClasses(
          'rounded-lg border bg-surface px-3 py-2 text-sm text-content transition-colors placeholder:text-content-muted focus:outline-none focus:ring-2 focus:ring-primary/40',
          error ? 'border-danger' : 'border-surface-border focus:border-primary',
        )
      "
    />

    <p v-if="error" class="text-xs text-danger">{{ error }}</p>
    <p v-else-if="hint" class="text-xs text-content-muted">{{ hint }}</p>
  </div>
</template>
