<script setup lang="ts">
  import { useApplications, type Application } from '~/composables/services/useApplications';

  const props = defineProps<{ application: Application; canManage: boolean }>();
  const emit = defineEmits<{ refresh: [] }>();

  const applicationsApi = useApplications();

  const volumes = computed(() => props.application.volumes ?? []);

  const messageOf = (error: unknown, fallback: string) =>
    (error as { message?: string }).message || fallback;

  const editing = ref(false);
  const saving = ref(false);
  const error = ref('');

  const draft = ref<{ source: string; target: string; readOnly: boolean }[]>([]);

  const startEdit = () => {
    draft.value = volumes.value.map(volume => ({
      source: volume.source,
      target: volume.target,
      readOnly: Boolean(volume.readOnly),
    }));
    error.value = '';
    editing.value = true;
  };

  const addVolume = () => draft.value.push({ source: '', target: '', readOnly: false });
  const removeVolume = (index: number) => draft.value.splice(index, 1);

  const save = async () => {
    const filled = draft.value.filter(volume => volume.source.trim() || volume.target.trim());

    if (!filled.every(volume => volume.source.trim() && volume.target.trim().startsWith('/'))) {
      error.value = 'Each volume needs a source and a target starting with "/".';
      return;
    }

    error.value = '';
    saving.value = true;

    try {
      await applicationsApi.update(props.application.id, {
        volumes: filled.map(volume => ({
          source: volume.source.trim(),
          target: volume.target.trim(),
          readOnly: volume.readOnly,
        })),
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
  <Card
    title="Volumes"
    description="Host paths and named volumes mounted into the container."
    content-class="p-0"
  >
    <template v-if="canManage" #right>
      <Button v-if="!editing" theme="secondary" size="xs" @click="startEdit">Edit</Button>
    </template>

    <template v-if="!editing">
      <Row as="div" class="flex items-baseline">
        <div class="w-33 shrink-0 text-caption text-ink-2">Mounts</div>
        <div class="font-mono text-caption text-ink">
          <span v-if="!volumes.length">None</span>
          <div v-else class="flex flex-col gap-0.5">
            <div v-for="(volume, index) in volumes" :key="index">
              {{ volume.source }}:{{ volume.target }}{{ volume.readOnly ? ' (ro)' : '' }}
            </div>
          </div>
        </div>
      </Row>
    </template>

    <div v-else class="flex flex-col">
      <Alert v-if="error" theme="error" class="mx-4.25 mt-3">{{ error }}</Alert>

      <div
        v-for="(volume, index) in draft"
        :key="index"
        class="flex items-center gap-2 border-b border-hairline px-4.25"
      >
        <Input v-model="volume.source" class="flex-1" placeholder="source" mono boxed bare />
        <span class="text-ink-3">:</span>
        <Input
          v-model="volume.target"
          class="flex-1"
          placeholder="/path/in/container"
          mono
          boxed
          bare
        />
        <label class="flex cursor-pointer items-center gap-1 text-caption text-ink-2">
          <Checkbox v-model="volume.readOnly" />
          ro
        </label>
        <button
          type="button"
          class="cursor-pointer rounded-control p-1.5 text-ink-2 hover:text-failed"
          @click="removeVolume(index)"
        >
          <Icon name="lucide:x" class="size-3.5" />
        </button>
      </div>

      <div class="border-b border-hairline px-4.25 py-2.5">
        <Button theme="quiet" size="sm" @click="addVolume">
          <Icon name="proicons:add" size="16" />
          Add volume
        </Button>
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
