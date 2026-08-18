<script setup lang="ts">
  import { useApplications, type Application } from '~/composables/services/useApplications';

  const props = defineProps<{ application: Application; canManage: boolean }>();
  const emit = defineEmits<{ refresh: [] }>();

  const applicationsApi = useApplications();

  const resources = computed(() => props.application.resources);

  const isCompose = computed(() => props.application.source === 'compose');

  const description = computed(() =>
    isCompose.value
      ? 'Ceiling the container may use on the server. It overrides the deploy.resources.limits of the compose file from the next deploy on. Empty means the limit declared in the compose file.'
      : 'Ceiling the container may use on the server. Empty means no limit.',
  );

  const messageOf = (error: unknown, fallback: string) =>
    (error as { message?: string }).message || fallback;

  const editing = ref(false);
  const saving = ref(false);
  const error = ref('');

  const draft = reactive({ cpus: '', memoryMb: '' });

  const startEdit = () => {
    draft.cpus = resources.value?.cpus != null ? String(resources.value.cpus) : '';
    draft.memoryMb = resources.value?.memoryMb != null ? String(resources.value.memoryMb) : '';
    error.value = '';
    editing.value = true;
  };

  const save = async () => {
    if (draft.cpus.trim() && !(Number(draft.cpus) > 0)) {
      error.value = 'CPUs must be a positive number.';
      return;
    }

    if (
      draft.memoryMb.trim() &&
      !(/^\d+$/.test(draft.memoryMb.trim()) && Number(draft.memoryMb) > 0)
    ) {
      error.value = 'Memory (MB) must be a positive integer.';
      return;
    }

    error.value = '';
    saving.value = true;

    try {
      await applicationsApi.update(props.application.id, {
        resources: {
          ...(draft.cpus.trim() ? { cpus: Number(draft.cpus) } : {}),
          ...(draft.memoryMb.trim() ? { memoryMb: Number(draft.memoryMb) } : {}),
        },
      });

      editing.value = false;
      emit('refresh');
    } catch (saveError) {
      error.value = messageOf(saveError, 'Failed to save.');
    } finally {
      saving.value = false;
    }
  };
</script>

<template>
  <Card title="Resource limits" :description="description" content-class="p-0">
    <template v-if="canManage" #right>
      <Button v-if="!editing" theme="secondary" size="xs" @click="startEdit">Edit</Button>
    </template>

    <template v-if="!editing">
      <Row as="div" class="flex items-baseline">
        <div class="w-33 shrink-0 text-caption text-ink-2">CPUs</div>
        <div class="font-mono text-caption text-ink">
          {{ resources?.cpus ?? (isCompose ? 'From the compose file' : 'No limit') }}
        </div>
      </Row>
      <Row as="div" class="flex items-baseline">
        <div class="w-33 shrink-0 text-caption text-ink-2">Memory</div>
        <div class="font-mono text-caption text-ink">
          {{
            resources?.memoryMb != null
              ? resources.memoryMb + ' MB'
              : isCompose
                ? 'From the compose file'
                : 'No limit'
          }}
        </div>
      </Row>
    </template>

    <div v-else class="flex flex-col">
      <Alert v-if="error" theme="error" class="mx-4.25 mt-3">{{ error }}</Alert>

      <div data-rows class="flex flex-col">
        <Input v-model="draft.cpus" label="CPUs" placeholder="e.g. 0.5" mono boxed />
        <Input v-model="draft.memoryMb" label="Memory (MB)" placeholder="e.g. 512" mono boxed />
      </div>

      <div class="flex flex-wrap items-center gap-2 px-4.25 py-3.25">
        <p class="text-caption text-ink-3">Changes take effect on the next deploy.</p>

        <div class="ml-auto flex items-center gap-2">
          <Button theme="quiet" size="sm" @click="editing = false">Cancel</Button>
          <Button theme="primary" size="sm" :disabled="saving" @click="save">
            <Icon v-if="saving" name="svg-spinners:tadpole" size="16" />
            Save
          </Button>
        </div>
      </div>
    </div>
  </Card>
</template>
