<script setup lang="ts">
  import DockerContainers from './DockerContainers.vue';
  import DockerImages from './DockerImages.vue';
  import DockerNetworks from './DockerNetworks.vue';
  import DockerVolumes from './DockerVolumes.vue';

  defineProps<{ serverId: string; canManage: boolean }>();

  type DockerTab = 'containers' | 'images' | 'networks' | 'volumes';

  const tabOptions: { label: string; value: DockerTab }[] = [
    { label: 'Containers', value: 'containers' },
    { label: 'Images', value: 'images' },
    { label: 'Networks', value: 'networks' },
    { label: 'Volumes', value: 'volumes' },
  ];

  const activeTab = ref<DockerTab>('containers');
</script>

<template>
  <div class="flex flex-col gap-3.5">
    <div class="flex items-center justify-between">
      <div class="text-[13px] font-semibold text-ink">Docker</div>
      <Segmented v-model="activeTab" :options="tabOptions" />
    </div>

    <DockerContainers
      v-if="activeTab === 'containers'"
      :server-id="serverId"
      :can-manage="canManage"
    />
    <DockerImages
      v-else-if="activeTab === 'images'"
      :server-id="serverId"
      :can-manage="canManage"
    />
    <DockerNetworks
      v-else-if="activeTab === 'networks'"
      :server-id="serverId"
      :can-manage="canManage"
    />
    <DockerVolumes v-else :server-id="serverId" :can-manage="canManage" />
  </div>
</template>
