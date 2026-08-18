<script setup lang="ts">
  import type { TemplateInput } from '~/composables/services/useTemplates';

  defineProps<{
    inputs: TemplateInput[];
    values: Record<string, string>;
    errors?: (key: string) => string | undefined;
  }>();

  const emit = defineEmits<{ 'update:value': [key: string, value: string] }>();

  defineOptions({ inheritAttrs: false });

  const setValue = (key: string, value: unknown) => emit('update:value', key, String(value));

  const rangePlaceholder = (input: TemplateInput) => {
    if (input.min !== undefined && input.max !== undefined) {
      return `${input.min}–${input.max}`;
    }

    if (input.min !== undefined) {
      return `${input.min} or greater`;
    }

    return input.max !== undefined ? `${input.max} or lower` : undefined;
  };
</script>

<template>
  <template v-for="input in inputs" :key="input.key">
    <Switch
      v-if="input.type === 'boolean'"
      :model-value="values[input.key] === 'true'"
      :label="input.label"
      class="px-4.25 py-3"
      :call-error="errors?.(input.key)"
      @update:model-value="value => setValue(input.key, value)"
    />
    <Select
      v-else-if="input.type === 'select'"
      :model-value="values[input.key]"
      :label="input.label"
      :options="(input.options ?? []).map(option => ({ value: option, label: option }))"
      boxed
      :call-error="errors?.(input.key)"
      @update:model-value="value => setValue(input.key, value)"
    />
    <Input
      v-else-if="input.type === 'number'"
      :model-value="values[input.key]"
      :label="input.label"
      type="number"
      :min="input.min"
      :max="input.max"
      :placeholder="rangePlaceholder(input)"
      mono
      boxed
      :call-error="errors?.(input.key)"
      @update:model-value="value => setValue(input.key, value)"
    />
    <Input
      v-else
      :model-value="values[input.key]"
      :label="input.label"
      :password="input.type === 'password'"
      mono
      boxed
      :call-error="errors?.(input.key)"
      @update:model-value="value => setValue(input.key, value)"
    />
    <p v-if="input.help" class="text-caption text-ink-3 in-data-rows:px-4.25">{{ input.help }}</p>
  </template>
</template>
