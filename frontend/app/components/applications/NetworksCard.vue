<script setup lang="ts">
  import { useApplications, type Application } from '~/composables/services/useApplications';

  const props = defineProps<{ application: Application; canManage: boolean }>();
  const emit = defineEmits<{ refresh: [] }>();

  const applicationsApi = useApplications();

  const networks = computed(() => props.application.networks ?? []);

  const messageOf = (error: unknown, fallback: string) =>
    (error as { message?: string }).message || fallback;

  const editingNetworks = ref(false);
  const networksDraft = ref<string[]>([]);
  const savingNetworks = ref(false);
  const networksError = ref('');

  const startEditNetworks = () => {
    networksDraft.value = [...networks.value];
    networksError.value = '';
    editingNetworks.value = true;
  };

  const addNetwork = () => networksDraft.value.push('');
  const removeNetwork = (index: number) => networksDraft.value.splice(index, 1);

  const saveNetworks = async () => {
    networksError.value = '';
    savingNetworks.value = true;

    try {
      await applicationsApi.update(props.application.id, {
        networks: networksDraft.value.map(network => network.trim()).filter(Boolean),
      });

      editingNetworks.value = false;
      emit('refresh');
    } catch (error) {
      networksError.value = messageOf(error, 'Failed to save the networks.');
    } finally {
      savingNetworks.value = false;
    }
  };
</script>

<template>
  <Card title="Extra networks" content-class="p-0">
    <template v-if="canManage" #right>
      <Button v-if="!editingNetworks" theme="secondary" size="xs" @click="startEditNetworks">
        Edit
      </Button>
    </template>

    <p v-if="!editingNetworks" class="px-4.25 py-4 font-mono text-caption text-ink">
      {{ networks.length ? networks.join(', ') : '—' }}
    </p>

    <div v-else class="flex flex-col">
      <Alert v-if="networksError" theme="error" class="mx-4.25 mt-3">{{ networksError }}</Alert>

      <div
        v-for="(_, index) in networksDraft"
        :key="index"
        class="flex items-center gap-2 border-b border-hairline px-4.25"
      >
        <Input
          v-model="networksDraft[index]"
          class="flex-1"
          placeholder="docker-network-name"
          mono
          boxed
          bare
        />
        <button
          type="button"
          class="cursor-pointer rounded-control p-1.5 text-ink-2 hover:text-failed"
          @click="removeNetwork(index)"
        >
          <Icon name="lucide:x" class="size-3.5" />
        </button>
      </div>

      <div class="flex flex-wrap items-center gap-2 px-4.25 py-3.25">
        <Button theme="quiet" size="sm" @click="addNetwork">
          <Icon name="proicons:add" size="16" />
          Add network
        </Button>
        <div class="ml-auto flex items-center gap-2">
          <Button theme="quiet" size="sm" @click="editingNetworks = false">Cancel</Button>
          <Button theme="primary" size="sm" :disabled="savingNetworks" @click="saveNetworks">
            <Icon v-if="savingNetworks" name="svg-spinners:tadpole" size="16" />
            Save
          </Button>
        </div>
      </div>

      <p class="px-4.25 pb-3.25 text-caption text-ink-3">Changes take effect on the next deploy.</p>
    </div>
  </Card>
</template>
