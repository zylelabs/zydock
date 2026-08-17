<script setup lang="ts">
  import { z } from 'zod';
  import {
    DATABASE_ENGINES,
    ENGINE_VERSION_OPTIONS,
    engineLabel,
    useDatabases,
    useEngineVersions,
    type Database,
    type DatabaseEngine,
  } from '~/composables/services/useDatabases';
  import type { Server } from '~/composables/services/useServers';

  const props = defineProps<{ servers: Server[] }>();

  const emit = defineEmits<{ created: [database: Database] }>();

  const open = defineModel<boolean>('open', { default: false });

  const { create } = useDatabases();
  const { load: loadEngineVersions } = useEngineVersions();

  const engineVersions = ref<Record<DatabaseEngine, string[]>>(ENGINE_VERSION_OPTIONS);

  const schema = z.object({
    name: z.string().trim().min(1, 'Enter a name'),
    serverId: z.string().min(1, 'Select a server'),
    engine: z.enum(DATABASE_ENGINES),
    version: z.string(),
  });

  const form = useSchemaForm(schema, {
    name: '',
    serverId: '',
    engine: 'postgresql' as DatabaseEngine,
    version: engineVersions.value.postgresql[0] ?? '',
  });

  const engineOptions = DATABASE_ENGINES.map(engine => ({
    value: engine,
    label: engineLabel(engine),
  }));

  const serverOptions = computed(() =>
    props.servers.map(server => ({ value: server.id, label: server.name })),
  );

  const versionOptions = computed(() =>
    engineVersions.value[form.values.engine].map(version => ({ value: version, label: version })),
  );

  watch(
    () => form.values.engine,
    engine => {
      form.values.version = engineVersions.value[engine][0] ?? '';
    },
  );

  const preselectServer = () => {
    const [onlyServer] = props.servers;

    if (props.servers.length === 1 && onlyServer) {
      form.values.serverId = onlyServer.id;
    }
  };

  watch(open, value => {
    if (value) {
      form.reset();
      preselectServer();

      loadEngineVersions().then(versions => {
        engineVersions.value = versions;
        form.values.version = versions[form.values.engine][0] ?? '';
      });
    }
  });

  const handleCreate = form.submit(async values => {
    const { database } = await create({
      serverId: values.serverId,
      name: values.name,
      engine: values.engine,
      version: values.version || undefined,
    });

    open.value = false;
    form.reset();
    emit('created', database);
  });
</script>

<template>
  <Card v-if="open" title="New database" class="max-w-130">
    <template #footer>
      <div class="flex w-full items-center justify-between gap-3">
        <p class="text-caption text-ink-2">
          Provisioning can take a while while the image is pulled on the server.
        </p>
        <div class="flex shrink-0 items-center gap-2">
          <Button theme="quiet" size="sm" @click="open = false">Cancel</Button>
          <Button
            theme="primary"
            size="sm"
            :disabled="!servers.length || form.loading.value"
            @click="handleCreate"
          >
            <Icon v-if="form.loading.value" name="svg-spinners:tadpole" size="16" />
            Create
          </Button>
        </div>
      </div>
    </template>

    <EmptyState
      v-if="!servers.length"
      description="No servers in this organization yet. A database needs a server to run on."
    >
      <Button theme="secondary" size="sm" to="/servers">Go to servers</Button>
    </EmptyState>

    <template v-else>
      <Alert v-if="form.formError.value" theme="error" class="mb-3">{{
        form.formError.value
      }}</Alert>

      <div class="flex flex-col gap-1.5">
        <Input
          v-model="form.values.name"
          label="Name"
          placeholder="orders-db"
          boxed
          bare
          :call-error="form.errors.value.name"
        />
        <Select
          v-model="form.values.serverId"
          label="Server"
          :options="serverOptions"
          boxed
          bare
          :call-error="form.errors.value.serverId"
        />
        <div class="flex items-center gap-3.5 border-b border-hairline py-3">
          <label class="w-33 shrink-0 text-caption text-ink-2">Engine</label>
          <Segmented v-model="form.values.engine" :options="engineOptions" size="sm" />
        </div>
        <Select
          v-model="form.values.version"
          label="Version"
          :options="versionOptions"
          searchable
          creatable
          boxed
          bare
        />
      </div>
    </template>
  </Card>
</template>
