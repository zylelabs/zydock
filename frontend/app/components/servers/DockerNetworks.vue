<script setup lang="ts">
  import { useNetworks, type NetworkInfo } from '~/composables/services/useNetworks';

  const props = defineProps<{ serverId: string; canManage: boolean }>();

  const toast = useToast();
  const api = useNetworks();

  const messageOf = (error: unknown, fallback: string) =>
    (error as { message?: string }).message || fallback;

  const networks = ref<NetworkInfo[]>([]);
  const loading = ref(false);
  const newName = ref('');
  const creating = ref(false);
  const busy = ref('');

  const load = async () => {
    loading.value = true;

    try {
      networks.value = await api.list(props.serverId);
    } catch (error) {
      networks.value = [];
      toast.error({ title: 'Error', message: messageOf(error, 'Failed to list the networks.') });
    } finally {
      loading.value = false;
    }
  };

  onMounted(load);

  const handleCreate = async () => {
    if (!newName.value.trim()) {
      return;
    }

    creating.value = true;

    try {
      await api.create(props.serverId, newName.value.trim());
      newName.value = '';
      await load();
    } catch (error) {
      toast.error({ title: 'Error', message: messageOf(error, 'Failed to create the network.') });
    } finally {
      creating.value = false;
    }
  };

  const handleRemove = async (network: NetworkInfo) => {
    busy.value = network.id;

    try {
      await api.remove(props.serverId, network.name);
      await load();
    } catch (error) {
      toast.error({ title: 'Error', message: messageOf(error, 'Failed to remove the network.') });
    } finally {
      busy.value = '';
    }
  };

  const columns = [
    { key: 'name', label: 'Network' },
    { key: 'driver', label: 'Driver' },
    { key: 'id', label: '', class: 'text-right' },
  ];
</script>

<template>
  <div class="flex flex-col gap-3">
    <form v-if="canManage" class="flex gap-2" @submit.prevent="handleCreate">
      <Input v-model="newName" class="flex-1" placeholder="my-network" compact />
      <Button theme="secondary" size="sm" type="submit" :disabled="creating">
        <Icon v-if="creating" name="svg-spinners:tadpole" size="16" />
        Create
      </Button>
    </form>

    <Table
      :columns="columns"
      :items="networks"
      grid-class="grid-cols-[1.6fr_0.6fr_auto]"
      :loading="loading"
      empty-label="No networks found."
    >
      <template #name="{ value }">
        <span class="truncate font-mono text-[13px] text-ink">{{ value }}</span>
      </template>
      <template #driver="{ value }">
        <span class="text-[12.5px] text-ink-2">{{ value }}</span>
      </template>
      <template #id="{ item }">
        <div class="flex items-center justify-end">
          <button
            v-if="canManage"
            type="button"
            title="Remove network"
            class="cursor-pointer rounded-button p-1.5 text-ink-2 hover:bg-inset hover:text-failed"
            :disabled="busy === (item as unknown as NetworkInfo).id"
            @click="handleRemove(item as unknown as NetworkInfo)"
          >
            <Icon name="lucide:trash-2" class="size-4" />
          </button>
        </div>
      </template>
    </Table>
  </div>
</template>
