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
      class="peer cursor-pointer rounded border-2 border-slate-400 transition-colors duration-300 ease-in-out checked:bg-primary checked:hover:bg-primary checked:border-primary checked:disabled:border-slate-300 checked:disabled:bg-slate-300 checked:disabled:hover:bg-slate-300 disabled:hover:none disabled:cursor-not-allowed disabled:border-slate-200 disabled:indeterminate:border-slate-300 disabled:indeterminate:bg-slate-300 disabled:hover:bg-transparent focus:ring-transparent hover:border-primary hover:bg-primary/10 indeterminate:bg-primary indeterminate:disabled:hover:bg-slate-300 size-[14px]"
      :type="props.type ? props.type : 'checkbox'"
      :name="props.name ? props.name : props.id"
      :checked="typeof checked === 'string' ? (checked === 'true' ? true : false) : checked"
      :value="value"
      :disabled="disabled"
    />
  </div>
</template>
