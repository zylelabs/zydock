<script setup lang="ts">
  const model = defineModel();

  const props = defineProps<{
    id?: string;
    name?: string;
    checked?: boolean | 'true' | 'false';
    type?: 'checkbox' | 'radio';
    value?: unknown;
    disabled?: boolean;
  }>();
</script>

<template>
  <div class="inline-flex items-center justify-start gap-2">
    <input
      :id="props.id"
      v-model="model"
      class="peer size-3.5 cursor-pointer rounded-sm border-2 border-edge-strong transition-colors checked:border-accent checked:bg-accent checked:hover:bg-accent hover:border-accent hover:bg-accent/10 indeterminate:border-accent indeterminate:bg-accent focus:ring-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:border-edge disabled:hover:bg-transparent disabled:checked:border-edge disabled:checked:bg-hairline disabled:indeterminate:border-edge disabled:indeterminate:bg-hairline"
      :type="props.type ? props.type : 'checkbox'"
      :name="props.name ? props.name : props.id"
      :checked="typeof checked === 'string' ? (checked === 'true' ? true : false) : checked"
      :value="value"
      :disabled="disabled"
    />
  </div>
</template>
