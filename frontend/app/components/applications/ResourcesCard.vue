<script setup lang="ts">
  import { useApplications, type Application } from '~/composables/services/useApplications';

  const props = defineProps<{ application: Application; canManage: boolean }>();
  const emit = defineEmits<{ refresh: [] }>();

  const applicationsApi = useApplications();

  const messageOf = (error: unknown, fallback: string) =>
    (error as { message?: string }).message || fallback;

  const editingAdv = ref(false);
  const savingAdv = ref(false);
  const advError = ref('');

  const advDraft = reactive({
    volumes: [] as { source: string; target: string; readOnly: boolean }[],
    healthcheckEnabled: false,
    hcPath: '/',
    hcInterval: '30',
    hcTimeout: '5',
    hcRetries: '3',
    hcStartPeriod: '',
    cpus: '',
    memoryMb: '',
  });

  const startEditAdv = () => {
    const app = props.application;

    advDraft.volumes = app.volumes.map(volume => ({
      source: volume.source,
      target: volume.target,
      readOnly: Boolean(volume.readOnly),
    }));
    advDraft.healthcheckEnabled = Boolean(app.healthcheck?.path);
    advDraft.hcPath = app.healthcheck?.path ?? '/';
    advDraft.hcInterval = String(app.healthcheck?.intervalSeconds ?? 30);
    advDraft.hcTimeout = String(app.healthcheck?.timeoutSeconds ?? 5);
    advDraft.hcRetries = String(app.healthcheck?.retries ?? 3);
    advDraft.hcStartPeriod =
      app.healthcheck?.startPeriodSeconds != null ? String(app.healthcheck.startPeriodSeconds) : '';
    advDraft.cpus = app.resources?.cpus != null ? String(app.resources.cpus) : '';
    advDraft.memoryMb = app.resources?.memoryMb != null ? String(app.resources.memoryMb) : '';
    advError.value = '';
    editingAdv.value = true;
  };

  const addVolume = () => advDraft.volumes.push({ source: '', target: '', readOnly: false });
  const removeVolume = (index: number) => advDraft.volumes.splice(index, 1);

  const saveAdv = async () => {
    const volumes = advDraft.volumes.filter(volume => volume.source.trim() || volume.target.trim());

    if (!volumes.every(volume => volume.source.trim() && volume.target.trim().startsWith('/'))) {
      advError.value = 'Each volume needs a source and a target starting with "/".';
      return;
    }

    if (advDraft.cpus.trim() && !(Number(advDraft.cpus) > 0)) {
      advError.value = 'CPUs must be a positive number.';
      return;
    }

    if (
      advDraft.memoryMb.trim() &&
      !(/^\d+$/.test(advDraft.memoryMb.trim()) && Number(advDraft.memoryMb) > 0)
    ) {
      advError.value = 'Memory (MB) must be a positive integer.';
      return;
    }

    const body: Record<string, unknown> = {
      volumes: volumes.map(volume => ({
        source: volume.source.trim(),
        target: volume.target.trim(),
        readOnly: volume.readOnly,
      })),
      resources: {
        ...(advDraft.cpus.trim() ? { cpus: Number(advDraft.cpus) } : {}),
        ...(advDraft.memoryMb.trim() ? { memoryMb: Number(advDraft.memoryMb) } : {}),
      },
    };

    if (advDraft.healthcheckEnabled) {
      if (!advDraft.hcPath.trim().startsWith('/')) {
        advError.value = 'The healthcheck path must start with "/".';
        return;
      }

      body.healthcheck = {
        path: advDraft.hcPath.trim(),
        intervalSeconds: Number(advDraft.hcInterval) || 30,
        timeoutSeconds: Number(advDraft.hcTimeout) || 5,
        retries: Number(advDraft.hcRetries) || 3,
        ...(advDraft.hcStartPeriod.trim()
          ? { startPeriodSeconds: Number(advDraft.hcStartPeriod) }
          : {}),
      };
    } else {
      body.healthcheck = null;
    }

    advError.value = '';
    savingAdv.value = true;

    try {
      await applicationsApi.update(props.application.id, body);

      editingAdv.value = false;
      emit('refresh');
    } catch (error) {
      advError.value = messageOf(error, 'Failed to save.');
    } finally {
      savingAdv.value = false;
    }
  };
</script>

<template>
  <Card title="Healthcheck, resources and volumes" content-class="p-0">
    <template v-if="canManage" #right>
      <Button v-if="!editingAdv" theme="secondary" size="xs" @click="startEditAdv">Edit</Button>
    </template>

    <template v-if="!editingAdv">
      <Row as="div" class="flex items-baseline">
        <div class="w-33 shrink-0 text-[13px] text-ink-2">Healthcheck</div>
        <div class="font-mono text-[13px] text-ink">
          <span v-if="!application.healthcheck">Disabled</span>
          <span v-else>
            {{ application.healthcheck.path }} · {{ application.healthcheck.intervalSeconds }}s /
            {{ application.healthcheck.timeoutSeconds }}s ×{{ application.healthcheck.retries }}
          </span>
        </div>
      </Row>
      <Row as="div" class="flex items-baseline">
        <div class="w-33 shrink-0 text-[13px] text-ink-2">Resources</div>
        <div class="font-mono text-[13px] text-ink">
          <span v-if="!application.resources?.cpus && !application.resources?.memoryMb">
            No limits
          </span>
          <span v-else>
            {{ application.resources?.cpus ? application.resources.cpus + ' CPU ' : '' }}
            {{ application.resources?.memoryMb ? application.resources.memoryMb + ' MB' : '' }}
          </span>
        </div>
      </Row>
      <Row as="div" class="flex items-baseline">
        <div class="w-33 shrink-0 text-[13px] text-ink-2">Volumes</div>
        <div class="font-mono text-[13px] text-ink">
          <span v-if="!application.volumes.length">None</span>
          <div v-else class="flex flex-col gap-0.5">
            <div v-for="(volume, index) in application.volumes" :key="index">
              {{ volume.source }}:{{ volume.target }}{{ volume.readOnly ? ' (ro)' : '' }}
            </div>
          </div>
        </div>
      </Row>
    </template>

    <div v-else class="flex flex-col gap-6 p-4.25">
      <Alert v-if="advError" theme="error">{{ advError }}</Alert>

      <div>
        <p class="mb-2 text-[13px] font-medium text-ink">Volumes</p>
        <div class="flex flex-col gap-2">
          <div
            v-for="(volume, index) in advDraft.volumes"
            :key="index"
            class="flex items-center gap-2"
          >
            <Input v-model="volume.source" class="flex-1" placeholder="source" mono compact />
            <span class="text-ink-3">:</span>
            <Input
              v-model="volume.target"
              class="flex-1"
              placeholder="/path/in/container"
              mono
              compact
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
          <Button theme="quiet" size="sm" class="self-start" @click="addVolume">
            <Icon name="proicons:add" size="16" />
            Add volume
          </Button>
        </div>
      </div>

      <div class="border-t border-hairline pt-4">
        <Switch v-model="advDraft.healthcheckEnabled" label="Enable healthcheck" />
        <div v-if="advDraft.healthcheckEnabled" class="mt-3 flex flex-col gap-1.5">
          <Input v-model="advDraft.hcPath" label="Path" placeholder="/health" mono compact />
          <Input v-model="advDraft.hcInterval" label="Interval (s)" compact />
          <Input v-model="advDraft.hcTimeout" label="Timeout (s)" compact />
          <Input v-model="advDraft.hcRetries" label="Retries" compact />
          <Input v-model="advDraft.hcStartPeriod" label="Start period (s)" compact />
        </div>
      </div>

      <div class="border-t border-hairline pt-4">
        <p class="mb-2 text-[13px] font-medium text-ink">Resources (empty means no limit)</p>
        <div class="flex flex-col gap-1.5">
          <Input v-model="advDraft.cpus" label="CPUs" placeholder="e.g. 0.5" compact />
          <Input v-model="advDraft.memoryMb" label="Memory (MB)" placeholder="e.g. 512" compact />
        </div>
      </div>

      <p class="text-caption text-ink-3">Changes take effect on the next deploy.</p>

      <div class="flex justify-end gap-2">
        <Button theme="quiet" size="sm" @click="editingAdv = false">Cancel</Button>
        <Button theme="primary" size="sm" :disabled="savingAdv" @click="saveAdv">
          <Icon v-if="savingAdv" name="svg-spinners:tadpole" size="16" />
          Save
        </Button>
      </div>
    </div>
  </Card>
</template>
