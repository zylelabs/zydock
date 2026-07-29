<script setup lang="ts">
  const {
    label = '',
    error = '',
    options,
    id = useId(),
  } = defineProps<{
    label?: string;
    error?: string;
    options: { value: string; label: string }[];
    id?: string;
  }>();

  const model = defineModel<string>({ default: '' });
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <label v-if="label" :for="id" class="text-sm font-medium text-content">{{ label }}</label>

    <select
      :id="id"
      v-model="model"
      :class="
        mergeClasses(
          'rounded-lg border bg-surface px-3 py-2 text-sm text-content transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40',
          error ? 'border-danger' : 'border-surface-border focus:border-primary',
        )
      "
    >
      <option v-for="option in options" :key="option.value" :value="option.value">
        {{ option.label }}
      </option>
    </select>

    <p v-if="error" class="text-xs text-danger">{{ error }}</p>
  </div>
</template>
