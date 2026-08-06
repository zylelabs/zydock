<script setup lang="ts">
  import { useApplications, type Application } from '~/composables/services/useApplications';

  const props = defineProps<{ application: Application; canManage: boolean }>();
  const emit = defineEmits<{ refresh: [] }>();

  const applicationsApi = useApplications();

  const messageOf = (error: unknown, fallback: string) =>
    (error as { message?: string }).message || fallback;

  type PortDraft = { hostPort: string; containerPort: string; protocol: string };

  const protocolOptions = [
    { value: 'tcp', label: 'tcp' },
    { value: 'udp', label: 'udp' },
  ];

  const editingPorts = ref(false);
  const portDraft = ref<PortDraft[]>([]);
  const savingPorts = ref(false);
  const portError = ref('');

  const startEditPorts = () => {
    portDraft.value = props.application.portMappings.map(mapping => ({
      hostPort: String(mapping.hostPort),
      containerPort: String(mapping.containerPort),
      protocol: mapping.protocol,
    }));
    portError.value = '';
    editingPorts.value = true;
  };

  const addPort = () => portDraft.value.push({ hostPort: '', containerPort: '', protocol: 'tcp' });
  const removePort = (index: number) => portDraft.value.splice(index, 1);

  const isPort = (value: string) =>
    /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 65535;

  const savePorts = async () => {
    const rows = portDraft.value.filter(row => row.hostPort.trim() || row.containerPort.trim());

    if (!rows.every(row => isPort(row.hostPort) && isPort(row.containerPort))) {
      portError.value = 'Enter valid ports (1–65535) for host and container.';
      return;
    }

    portError.value = '';
    savingPorts.value = true;

    try {
      await applicationsApi.update(props.application.id, {
        portMappings: rows.map(row => ({
          hostPort: Number(row.hostPort),
          containerPort: Number(row.containerPort),
          protocol: row.protocol === 'udp' ? 'udp' : 'tcp',
        })),
      });

      editingPorts.value = false;
      emit('refresh');
    } catch (error) {
      portError.value = messageOf(error, 'Failed to save the ports.');
    } finally {
      savingPorts.value = false;
    }
  };
</script>

<template>
  <Card title="Ports" content-class="p-0">
    <template v-if="canManage" #right>
      <Button v-if="!editingPorts" theme="secondary" size="xs" @click="startEditPorts">Edit</Button>
    </template>

    <Row as="div" class="flex items-center">
      <div class="w-33 shrink-0 text-[13px] text-ink-2">Exposed port</div>
      <div class="font-mono text-[13px] text-ink">{{ application.port }}</div>
    </Row>

    <template v-if="!editingPorts">
      <p v-if="!application.portMappings.length" class="px-4.25 py-4 text-caption text-ink-2">
        No published ports. Publish a host port to expose a service without going through the proxy.
      </p>
      <Row
        v-for="(mapping, index) in application.portMappings"
        :key="index"
        as="div"
        class="flex items-center font-mono text-[13px] text-ink"
      >
        <span>{{ mapping.hostPort }} → {{ mapping.containerPort }}</span>
        <span class="text-ink-3">/{{ mapping.protocol }}</span>
      </Row>
    </template>

    <div v-else class="flex flex-col gap-3 p-4.25">
      <Alert v-if="portError" theme="error">{{ portError }}</Alert>

      <div v-for="(mapping, index) in portDraft" :key="index" class="flex items-center gap-2">
        <Input
          v-model="mapping.hostPort"
          class="flex-1"
          placeholder="Host, e.g. 8080"
          mono
          compact
        />
        <span class="text-ink-3">→</span>
        <Input
          v-model="mapping.containerPort"
          class="flex-1"
          placeholder="Container, e.g. 3000"
          mono
          compact
        />
        <div class="w-24">
          <Select v-model="mapping.protocol" :options="protocolOptions" />
        </div>
        <button
          type="button"
          class="cursor-pointer rounded-control p-1.5 text-ink-2 hover:text-failed"
          @click="removePort(index)"
        >
          <Icon name="lucide:x" class="size-3.5" />
        </button>
      </div>

      <div class="flex items-center justify-between">
        <Button theme="quiet" size="sm" @click="addPort">
          <Icon name="proicons:add" size="16" />
          Add mapping
        </Button>
        <div class="flex gap-2">
          <Button theme="quiet" size="sm" @click="editingPorts = false">Cancel</Button>
          <Button theme="primary" size="sm" :disabled="savingPorts" @click="savePorts">
            <Icon v-if="savingPorts" name="svg-spinners:tadpole" size="16" />
            Save
          </Button>
        </div>
      </div>

      <p class="text-caption text-ink-3">Changes take effect on the next deploy.</p>
    </div>
  </Card>
</template>
