<script setup lang="ts">
  import { useApplications, type Application } from '~/composables/services/useApplications';

  const props = defineProps<{ application: Application; canManage: boolean }>();
  const emit = defineEmits<{ refresh: [] }>();

  const applicationsApi = useApplications();

  const healthcheck = computed(() => props.application.healthcheck);

  const messageOf = (error: unknown, fallback: string) =>
    (error as { message?: string }).message || fallback;

  const editing = ref(false);
  const saving = ref(false);
  const error = ref('');

  const draft = reactive({
    enabled: false,
    path: '/',
    interval: '30',
    timeout: '5',
    retries: '3',
    startPeriod: '',
  });

  const startEdit = () => {
    const current = healthcheck.value;

    draft.enabled = Boolean(current?.path);
    draft.path = current?.path ?? '/';
    draft.interval = String(current?.intervalSeconds ?? 30);
    draft.timeout = String(current?.timeoutSeconds ?? 5);
    draft.retries = String(current?.retries ?? 3);
    draft.startPeriod =
      current?.startPeriodSeconds != null ? String(current.startPeriodSeconds) : '';
    error.value = '';
    editing.value = true;
  };

  const save = async () => {
    if (draft.enabled && !draft.path.trim().startsWith('/')) {
      error.value = 'The healthcheck path must start with "/".';
      return;
    }

    const body = draft.enabled
      ? {
          healthcheck: {
            path: draft.path.trim(),
            intervalSeconds: Number(draft.interval) || 30,
            timeoutSeconds: Number(draft.timeout) || 5,
            retries: Number(draft.retries) || 3,
            ...(draft.startPeriod.trim() ? { startPeriodSeconds: Number(draft.startPeriod) } : {}),
          },
        }
      : { healthcheck: null };

    error.value = '';
    saving.value = true;

    try {
      await applicationsApi.update(props.application.id, body);

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
    title="Healthcheck"
    description="Docker probes the container on this path and restarts it when it stops answering."
    content-class="p-0"
  >
    <template v-if="canManage" #right>
      <Button v-if="!editing" theme="secondary" size="xs" @click="startEdit">Edit</Button>
    </template>

    <template v-if="!editing">
      <Row as="div" class="flex items-baseline">
        <div class="w-33 shrink-0 text-caption text-ink-2">Status</div>
        <div class="text-caption text-ink">{{ healthcheck ? 'Enabled' : 'Disabled' }}</div>
      </Row>

      <template v-if="healthcheck">
        <Row as="div" class="flex items-baseline">
          <div class="w-33 shrink-0 text-caption text-ink-2">Path</div>
          <div class="font-mono text-caption text-ink">{{ healthcheck.path }}</div>
        </Row>
        <Row as="div" class="flex items-baseline">
          <div class="w-33 shrink-0 text-caption text-ink-2">Interval</div>
          <div class="font-mono text-caption text-ink">{{ healthcheck.intervalSeconds }}s</div>
        </Row>
        <Row as="div" class="flex items-baseline">
          <div class="w-33 shrink-0 text-caption text-ink-2">Timeout</div>
          <div class="font-mono text-caption text-ink">{{ healthcheck.timeoutSeconds }}s</div>
        </Row>
        <Row as="div" class="flex items-baseline">
          <div class="w-33 shrink-0 text-caption text-ink-2">Retries</div>
          <div class="font-mono text-caption text-ink">{{ healthcheck.retries }}</div>
        </Row>
        <Row as="div" class="flex items-baseline">
          <div class="w-33 shrink-0 text-caption text-ink-2">Start period</div>
          <div class="font-mono text-caption text-ink">
            {{
              healthcheck.startPeriodSeconds != null ? healthcheck.startPeriodSeconds + 's' : '—'
            }}
          </div>
        </Row>
      </template>
    </template>

    <div v-else class="flex flex-col">
      <Alert v-if="error" theme="error" class="mx-4.25 mt-3">{{ error }}</Alert>

      <div class="flex items-center border-b border-hairline px-4.25 py-3.25">
        <Switch v-model="draft.enabled" label="Enable healthcheck" />
      </div>

      <div v-if="draft.enabled" data-rows class="flex flex-col">
        <Input v-model="draft.path" label="Path" placeholder="/health" mono boxed />
        <Input v-model="draft.interval" label="Interval (s)" mono boxed />
        <Input v-model="draft.timeout" label="Timeout (s)" mono boxed />
        <Input v-model="draft.retries" label="Retries" mono boxed />
        <Input v-model="draft.startPeriod" label="Start period (s)" mono boxed />
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
