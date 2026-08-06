<script setup lang="ts">
  import type { ProvisioningResult, ProvisioningStepName } from '~/composables/services/useServers';

  const props = defineProps<{ running: boolean; results: ProvisioningResult[] }>();

  const STEPS: ProvisioningStepName[] = [
    'connect',
    'install-docker',
    'install-runtime',
    'install-proxy',
    'upload-agent',
    'configure-agent',
    'start-agent',
    'verify-agent',
  ];

  const LABEL: Record<ProvisioningStepName, string> = {
    connect: 'Connect over SSH',
    'install-docker': 'Install Docker',
    'install-runtime': 'Install runtime',
    'install-proxy': 'Install reverse proxy',
    'upload-agent': 'Upload agent',
    'configure-agent': 'Configure agent',
    'start-agent': 'Start agent',
    'verify-agent': 'Verify',
  };

  const stepList = computed(() =>
    STEPS.map(step => {
      const result = props.results.find(entry => entry.step === step);

      if (!result) {
        return { label: LABEL[step], status: 'pending' as const };
      }

      return {
        label: LABEL[step],
        status: result.ok ? ('done' as const) : ('running' as const),
        hint: result.ok ? undefined : result.detail,
        time: result.ok ? result.detail : undefined,
      };
    }),
  );
</script>

<template>
  <Card v-if="running || results.length" title="Provisioning" content-class="p-2">
    <StepList :steps="stepList" />
  </Card>
</template>
