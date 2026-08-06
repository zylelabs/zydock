<script setup lang="ts">
  type Frequency = 'hourly' | 'daily' | 'weekly';
  type Channel = 'stable' | 'nightly' | 'dev' | 'branch';

  const FREQUENCY_OPTIONS: { label: string; value: Frequency }[] = [
    { label: 'Hourly', value: 'hourly' },
    { label: 'Daily', value: 'daily' },
    { label: 'Weekly', value: 'weekly' },
  ];

  const WINDOW_TEXT: Record<Frequency, string> = {
    hourly: 'Hourly, at minute 0 (America/Sao_Paulo)',
    daily: 'Daily, 03:00–05:00 (America/Sao_Paulo)',
    weekly: 'Weekly, Sunday 03:00–05:00 (America/Sao_Paulo)',
  };

  const CHANNELS: { value: Channel; title: string; description: string; version: string }[] = [
    {
      value: 'stable',
      title: 'Stable',
      description: 'Tagged releases. Recommended for production hosts.',
      version: 'v2.7.4',
    },
    {
      value: 'nightly',
      title: 'Nightly',
      description: 'Built from main every night. Occasional regressions.',
      version: 'v2.8.0-n612',
    },
    {
      value: 'dev',
      title: 'Dev',
      description: 'Every merged commit. Expect breakage.',
      version: 'v2.8.0-dev',
    },
    {
      value: 'branch',
      title: 'Specific branch',
      description: 'Track a branch of the Zydock repository.',
      version: '—',
    },
  ];

  const installed = { version: 'v2.7.3', commit: '4a91c02' };
  const updateAvailable = true;
  const lastChecked = '12 minutes ago · automatic';

  const state = reactive({
    autoUpdateEnabled: true,
    frequency: 'daily' as Frequency,
    channel: 'stable' as Channel,
  });

  const branchDraft = ref('feature/queue-rewrite');
  const appliedBranch = ref('');

  const applyBranch = () => {
    appliedBranch.value = branchDraft.value;
  };

  const channelVersion = (channel: (typeof CHANNELS)[number]) =>
    channel.value === 'branch' ? appliedBranch.value || channel.version : channel.version;
</script>

<template>
  <div class="flex flex-col gap-4.5">
    <Card title="Automatic updates" rows>
      <template #right>
        <Switch v-model="state.autoUpdateEnabled" aria-label="Automatic updates" />
      </template>

      <Row
        as="div"
        :class="
          state.autoUpdateEnabled
            ? 'flex flex-wrap items-center gap-y-1.5'
            : 'flex flex-wrap items-center gap-y-1.5 pointer-events-none opacity-50'
        "
      >
        <div class="w-33 shrink-0 text-[13px] text-ink-2">Frequency</div>
        <Segmented v-model="state.frequency" :options="FREQUENCY_OPTIONS" size="sm" />
      </Row>
      <Row
        as="div"
        :class="
          state.autoUpdateEnabled
            ? 'flex flex-wrap items-center gap-y-1.5'
            : 'flex flex-wrap items-center gap-y-1.5 opacity-50'
        "
      >
        <div class="w-33 shrink-0 text-[13px] text-ink-2">Window</div>
        <div class="min-w-0 flex-1 text-[13px] text-ink wrap-break-word">
          {{ WINDOW_TEXT[state.frequency] }}
        </div>
      </Row>
    </Card>

    <Card title="Update channel" description="Where releases are pulled from." content-class="p-0">
      <div
        v-for="channel in CHANNELS"
        :key="channel.value"
        class="border-t border-hairline first:border-t-0"
      >
        <div
          class="flex cursor-pointer items-start gap-3.5 px-4.25 py-3.25"
          :class="state.channel === channel.value && 'bg-row-hover'"
          @click="state.channel = channel.value"
        >
          <Radio
            :id="`channel-${channel.value}`"
            v-model="state.channel"
            name="update-channel"
            :value="channel.value"
            class="mt-0.5"
          />
          <div class="min-w-0 flex-1">
            <label
              :for="`channel-${channel.value}`"
              class="cursor-pointer text-[13.5px] font-medium text-ink"
            >
              {{ channel.title }}
            </label>
            <p class="text-caption text-ink-2">{{ channel.description }}</p>
          </div>
          <div class="shrink-0 self-center font-mono text-[13px] text-ink-2">
            {{ channelVersion(channel) }}
          </div>
        </div>

        <div
          v-if="channel.value === 'branch' && state.channel === 'branch'"
          class="flex items-center gap-2.5 px-4.25 pb-3.25"
        >
          <Input
            v-model="branchDraft"
            mono
            boxed
            bare
            placeholder="feature/queue-rewrite"
            class="flex-1"
          />
          <Button theme="secondary" size="sm" @click="applyBranch">Use branch</Button>
        </div>
      </div>
    </Card>

    <Card rows>
      <Row as="div" class="flex flex-wrap items-center gap-y-1.5">
        <div class="w-33 shrink-0 text-[13px] text-ink-2">Installed</div>
        <div class="min-w-0 flex-1 font-mono text-[13px] text-ink">
          {{ installed.version }} · {{ installed.commit }}
        </div>
        <Tag :color="updateAvailable ? 'attn' : 'live'">
          {{ updateAvailable ? 'Update available' : 'Up to date' }}
        </Tag>
      </Row>
      <Row as="div" class="flex flex-wrap items-center gap-y-1.5">
        <div class="w-33 shrink-0 text-[13px] text-ink-2">Last checked</div>
        <div class="min-w-0 flex-1 text-[13px] text-ink">{{ lastChecked }}</div>
      </Row>

      <template #footer>
        <div class="flex flex-1 flex-wrap items-center justify-between gap-3">
          <p class="text-caption text-ink-2">
            {{
              updateAvailable
                ? `${CHANNELS[0]!.version} is ready. Release notes open in the changelog.`
                : 'Forcing an update reinstalls the current channel head, even if nothing changed.'
            }}
          </p>
          <div class="flex gap-2">
            <Button theme="secondary" size="sm">Check for updates</Button>
            <Button theme="primary" size="sm">Force update now</Button>
          </div>
        </div>
      </template>
    </Card>
  </div>
</template>
