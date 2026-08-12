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
</script>

<template>
  <template v-for="input in inputs" :key="input.key">
    <Switch
      v-if="input.type === 'boolean'"
      :model-value="values[input.key] === 'true'"
      class="px-4.25 py-3"
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
      v-else
      :model-value="values[input.key]"
      :label="input.label"
      :password="input.type === 'password'"
      mono
      boxed
      :call-error="errors?.(input.key)"
      @update:model-value="value => setValue(input.key, value)"
    />
  </template>
</template>
