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
    required?: boolean;
    labelWidth?: string;
    mono?: boolean;
    /**
     * Drops the field's own divider, for inputs placed side by side inside a row that already
     * carries the divider (variable pairs, volume mappings).
     */
    bare?: boolean;
    /**
     * Label above the field instead of to its left, the way the auth screens stack them.
     * The row keeps the divider on top (like `Row`), so the first field sits flush with the card.
     */
    stacked?: boolean;
    /**
     * Draws the field as a filled box to the right of the label, for rows that turn editable in
     * place and need the input to read as an input. Ignored when `stacked`.
     */
    boxed?: boolean;
  }>();
  const emit = defineEmits(['input', 'focus']);

  const model = defineModel<string | number>();

  const data = reactive<{ defaultValue: unknown }>({
    defaultValue: '',
  });

  const refMask = ref();

  const viewPassword = ref(true);

  const fallbackId = useId();

  const inputId = ref(
    props.id || formatter.slugify(`${props.mask || ''}-${props.label || fallbackId}`),
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
  <div
    class="flex flex-col"
    :class="
      stacked
        ? [
            'border-t transition-shadow first:border-t-0 ',
            errorMessage || callError ? 'border-failed/40' : 'border-hairline',
          ]
        : 'gap-1.5'
    "
  >
    <div
      :class="[
        stacked
          ? 'flex flex-col items-start gap-0.75 px-3.75 pt-2.25 pb-2.75'
          : [
              'flex in-data-rows:px-4.25',
              boxed ? 'gap-1.75 py-1.5' : ['gap-3.5 transition-shadow ', compact ? 'py-2' : 'py-3'],
              type === 'textarea' ? 'items-start' : 'items-center',
              !bare && [
                'border-b',
                errorMessage || callError ? 'border-failed/40' : 'border-hairline',
              ],
            ],
      ]"
    >
      <label
        v-if="label"
        :for="inputId"
        class="shrink-0 text-ink-2"
        :class="[
          stacked ? 'text-caption' : ['text-caption', labelWidth || 'w-33'],
          { 'text-ink-3': disabled },
        ]"
      >
        {{ label }}
        <span v-if="required" class="text-failed">*</span>
      </label>

      <div
        class="relative flex min-w-0"
        :class="[
          stacked ? 'w-full' : 'flex-1',
          !stacked &&
            boxed && [
              'items-center rounded-control border bg-inset px-2.5 py-1.5 transition-colors focus-within:border-accent',
              errorMessage || callError ? 'border-failed/50' : 'border-edge',
            ],
        ]"
      >
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
              'w-full resize-none bg-transparent text-body text-ink outline-none placeholder:text-ink-3 disabled:cursor-not-allowed disabled:text-ink-3',
              mono && 'font-mono',
              boxed && !stacked && 'text-caption',
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
              'w-full min-w-0 bg-transparent text-body text-ink outline-none placeholder:text-ink-3 disabled:cursor-not-allowed disabled:text-ink-3',
              mono && 'font-mono',
              boxed && !stacked && 'text-caption',
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
          class="ml-2 shrink-0 text-ink-2 transition hover:text-ink disabled:cursor-not-allowed disabled:text-ink-3"
          @click="viewPassword = !viewPassword"
        >
          <Icon :name="viewPassword ? 'proicons:eye-off' : 'proicons:eye'" class="size-4" />
        </button>
      </div>
    </div>
    <span
      v-if="errorMessage || callError"
      class="text-caption text-failed"
      :class="stacked ? 'px-3.75 pb-2.5' : 'in-data-rows:px-4.25'"
      >{{ errorMessage ? errorMessage : callError }}</span
    >
  </div>
</template>
