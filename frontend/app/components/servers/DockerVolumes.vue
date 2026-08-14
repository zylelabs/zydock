<script setup lang="ts">
  import { useVolumes, type VolumeInfo } from '~/composables/services/useVolumes';

  const props = defineProps<{ serverId: string; canManage: boolean }>();

  const toast = useToast();
  const api = useVolumes();

  const messageOf = (error: unknown, fallback: string) =>
    (error as { message?: string }).message || fallback;

  const volumes = ref<VolumeInfo[]>([]);
  const loading = ref(false);
  const newName = ref('');
  const creating = ref(false);
  const busy = ref('');

  const load = async () => {
    loading.value = true;

    try {
      volumes.value = await api.list(props.serverId);
    } catch (error) {
      volumes.value = [];
      toast.error({ title: 'Error', message: messageOf(error, 'Failed to list the volumes.') });
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
      toast.error({ title: 'Error', message: messageOf(error, 'Failed to create the volume.') });
    } finally {
      creating.value = false;
    }
  };

  const PROTECTED_TITLE = 'System resource of the Zydock platform — cannot be removed.';

  const handleRemove = async (volume: VolumeInfo) => {
    if (volume.protected) {
      return;
    }

    busy.value = volume.name;

    try {
      await api.remove(props.serverId, volume.name);
      await load();
    } catch (error) {
      toast.error({ title: 'Error', message: messageOf(error, 'Failed to remove the volume.') });
    } finally {
      busy.value = '';
    }
  };

  const columns = [
    { key: 'name', label: 'Volume' },
    { key: 'mountpoint', label: 'Mountpoint' },
    { key: 'actions', label: '', class: 'text-right' },
  ];
</script>

<template>
  <div class="flex flex-col gap-3">
    <form v-if="canManage" class="flex gap-2" @submit.prevent="handleCreate">
      <Input v-model="newName" class="flex-1" placeholder="my-volume" mono boxed bare />
      <Button theme="secondary" size="sm" type="submit" :disabled="creating">
        <Icon v-if="creating" name="svg-spinners:tadpole" size="16" />
        Create
      </Button>
    </form>

    <Table
      :columns="columns"
      :items="volumes"
      grid-class="grid-cols-[1.2fr_1fr_auto]"
      :loading="loading"
      empty-label="No volumes found."
      row-key="name"
    >
      <template #name="{ item, value }">
        <div class="flex min-w-0 items-center gap-2">
          <span class="truncate font-mono text-caption text-ink">{{ value }}</span>
          <Tag v-if="(item as unknown as VolumeInfo).protected" :title="PROTECTED_TITLE"
            >system</Tag
          >
        </div>
      </template>
      <template #mountpoint="{ value }">
        <span class="truncate text-caption text-ink-2">{{ value }}</span>
      </template>
      <template #actions="{ item }">
        <div class="flex items-center justify-end">
          <button
            v-if="canManage"
            type="button"
            :title="(item as unknown as VolumeInfo).protected ? PROTECTED_TITLE : 'Remove volume'"
            class="cursor-pointer rounded-button p-1.5 text-ink-2 hover:bg-inset hover:text-failed disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ink-2"
            :disabled="
              busy === (item as unknown as VolumeInfo).name ||
              (item as unknown as VolumeInfo).protected
            "
            @click="handleRemove(item as unknown as VolumeInfo)"
          >
            <Icon name="lucide:trash-2" class="size-4" />
          </button>
        </div>
      </template>
    </Table>
  </div>
</template>
