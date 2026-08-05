<script setup lang="ts">
  import { MaskInput } from 'maska';
  import type { ClassNameValue } from 'tailwind-merge';
  import type { InputTypeHTMLAttribute } from 'vue';
  import type { ZodError } from 'zod';
  import { toRaw } from 'vue';
  import { mergeClasses } from '~/utils';
  import type { MasksPatternKeys } from '~/utils/constants';
  import formatter from '~/utils/formatter';

  const props = defineProps<{
    id?: string;
    defaultValue?: unknown;
    label?: string;
    placeholder?: string | boolean;
    password?: boolean;
    type?: InputTypeHTMLAttribute | 'textarea';
    min?: Numberish | undefined;
    max?: Numberish | undefined;
    mask?: string | MasksPatternKeys;
    inputClass?: ClassNameValue;
    disabled?: boolean;
    zodError?: ZodError;
    callError?: string;
    compact?: boolean;
    rows?: number;
    cols?: number;
    labelInline?: boolean;
    required?: boolean;
  }>();
  const emit = defineEmits(['input', 'focus']);

  const model = defineModel<string | number>();

  const data = reactive<{ defaultValue: unknown }>({
    defaultValue: '',
  });

  const refMask = ref();

  const viewPassword = ref(true);

  const inputId = ref(
    props.id || formatter.slugify(`${props.mask || ''}-${props.label || crypto.randomUUID()}`),
  );

  const errorMessage = ref('');

  watch(
    () => props.zodError,
    (newError?: ZodError) => {
      errorMessage.value = '';

      if (!newError || !props.id) {
        return;
      }

      const raw = toRaw(newError) as unknown as {
        issues?: Array<{ path: string[]; message?: string }>;
      };

      const issues = Array.isArray(raw?.issues) ? raw.issues : [];

      let error = '';
      issues.forEach(item => {
        if (item.path.includes(props.id as string)) {
          error = item.message || '';
        }
      });

      if (error) {
        errorMessage.value = error;
      }
    },
  );

  const loadMasks = () => {
    if (!props.mask) {
      return;
    }

    switch (props.mask) {
      default:
        refMask.value = new MaskInput(`#${inputId.value}`, {
          mask: props.mask,
        });
        break;
    }
  };

  const handleInput = (e: Event) => {
    emit('input', {
      id: props?.id,
      defaultValue: data.defaultValue,
      currentValue: (e.target as HTMLInputElement).value,
    });
  };

  onMounted(async () => {
    data.defaultValue = props.defaultValue;

    if (window && inputId.value) {
      await nextTick();
      setTimeout(() => loadMasks(), 100);
    }
  });

  watch(model, newVal => {
    if (refMask.value && newVal) {
      loadMasks();
    }
  });
</script>

<template>
  <div class="flex flex-col gap-1" :class="{ 'flex-row! items-center gap-2': labelInline }">
    <label
      v-if="label"
      :for="inputId"
      class="flex gap-0.5 text-xs font-semibold tracking-widest text-content-muted uppercase mb-1"
      :class="{ 'text-content-dim': disabled }"
    >
      {{ label }}
      <div v-if="required" class="text-danger">*</div>
    </label>
    <div class="relative flex">
      <textarea
        v-if="type === 'textarea'"
        :id="inputId"
        v-model="model"
        :name="id"
        :placeholder="
          placeholder !== ''
            ? ((placeholder as string) !== 'false' && (placeholder as string)) || ''
            : label
        "
        :class="
          mergeClasses(
            'w-full border rounded-lg shadow-sm px-2 py-2 bg-surface-sunken text-content-strong placeholder:text-content-muted focus:outline-none focus:border-primary-400 focus:ring-1 focus:ring-primary-400/40 transition duration-200 disabled:cursor-not-allowed disabled:text-content-dim disabled:border-surface-line resize-none',
            errorMessage || callError ? 'border-danger' : 'border-field-border',
            compact && 'py-1',
            inputClass,
          )
        "
        :disabled="disabled"
        :rows="rows"
        :cols="cols"
        :required="required"
        @input="handleInput"
        @focus="e => emit('focus', e)"
      ></textarea>

      <input
        v-else
        :id="inputId"
        v-model="model"
        :name="id"
        :placeholder="
          placeholder !== ''
            ? ((placeholder as string) !== 'false' && (placeholder as string)) || ''
            : label
        "
        :type="password ? (viewPassword ? 'password' : 'text') : type"
        :class="
          mergeClasses(
            'w-full border rounded-lg shadow-sm px-2 py-2 bg-surface-sunken text-content-strong placeholder:text-content-muted focus:outline-none focus:border-primary-400 focus:ring-1 focus:ring-primary-400/40 transition duration-200 disabled:cursor-not-allowed disabled:text-content-dim disabled:border-surface-line',
            errorMessage || callError ? 'border-danger' : 'border-surface-border',
            compact && 'py-1',
            inputClass,
          )
        "
        :disabled="disabled"
        :min="min"
        :max="max"
        :required="required"
        @focus="e => emit('focus', e)"
      />

      <button
        v-if="password && type !== 'textarea'"
        type="button"
        :disabled="disabled"
        :aria-label="viewPassword ? 'Show password' : 'Hide password'"
        class="text-2xl absolute right-2 bottom-1 z-50 text-content-muted transition hover:text-content-strong disabled:cursor-not-allowed disabled:text-content-dim"
        @click="viewPassword = !viewPassword"
      >
        <Icon :name="viewPassword ? 'proicons:eye-off' : 'proicons:eye'" />
      </button>
    </div>
    <span v-if="errorMessage || callError" class="text-danger text-xs">{{
      errorMessage ? errorMessage : callError
    }}</span>
  </div>
</template>
