<script setup lang="ts">
  import { useImages, type ImageInfo } from '~/composables/services/useImages';
  import { formatBytes } from '~/utils';

  const props = defineProps<{ serverId: string; canManage: boolean }>();

  const toast = useToast();
  const api = useImages();

  const messageOf = (error: unknown, fallback: string) =>
    (error as { message?: string }).message || fallback;

  const images = ref<ImageInfo[]>([]);
  const loading = ref(false);
  const pullReference = ref('');
  const pulling = ref(false);
  const busy = ref('');

  const load = async () => {
    loading.value = true;

    try {
      images.value = await api.list(props.serverId);
    } catch (error) {
      images.value = [];
      toast.error({ title: 'Error', message: messageOf(error, 'Failed to list the images.') });
    } finally {
      loading.value = false;
    }
  };

  onMounted(load);

  const handlePull = async () => {
    if (!pullReference.value.trim()) {
      return;
    }

    pulling.value = true;

    try {
      await api.pull(props.serverId, pullReference.value.trim());
      pullReference.value = '';
      await load();
    } catch (error) {
      toast.error({ title: 'Error', message: messageOf(error, 'Failed to pull the image.') });
    } finally {
      pulling.value = false;
    }
  };

  const handleRemove = async (image: ImageInfo) => {
    busy.value = image.id;

    try {
      await api.remove(props.serverId, image.tag);
      await load();
    } catch (error) {
      toast.error({ title: 'Error', message: messageOf(error, 'Failed to remove the image.') });
    } finally {
      busy.value = '';
    }
  };

  const columns = [
    { key: 'tag', label: 'Image' },
    { key: 'sizeBytes', label: 'Size' },
    { key: 'id', label: '', class: 'text-right' },
  ];
</script>

<template>
  <div class="flex flex-col gap-3">
    <form v-if="canManage" class="flex gap-2" @submit.prevent="handlePull">
      <Input v-model="pullReference" class="flex-1" placeholder="nginx:latest" compact />
      <Button theme="secondary" size="sm" type="submit" :disabled="pulling">
        <Icon v-if="pulling" name="svg-spinners:tadpole" size="16" />
        Pull
      </Button>
    </form>

    <Table
      :columns="columns"
      :items="images"
      grid-class="grid-cols-[1.6fr_0.6fr_auto]"
      :loading="loading"
      empty-label="No images found."
    >
      <template #tag="{ value }">
        <span class="truncate font-mono text-[13px] text-ink">{{ value }}</span>
      </template>
      <template #sizeBytes="{ value }">
        <span class="text-[12.5px] text-ink-2">{{ formatBytes(value as number) }}</span>
      </template>
      <template #id="{ item }">
        <div class="flex items-center justify-end">
          <button
            v-if="canManage"
            type="button"
            title="Remove image"
            class="cursor-pointer rounded-button p-1.5 text-ink-2 hover:bg-inset hover:text-failed"
            :disabled="busy === (item as unknown as ImageInfo).id"
            @click="handleRemove(item as unknown as ImageInfo)"
          >
            <Icon name="lucide:trash-2" class="size-4" />
          </button>
        </div>
      </template>
    </Table>
  </div>
</template>
