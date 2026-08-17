<script setup lang="ts">
  import {
    useDatabases,
    type Database,
    type DatabaseCredentials,
  } from '~/composables/services/useDatabases';
  import type { Server } from '~/composables/services/useServers';

  const props = defineProps<{ database: Database; server?: Server | null }>();

  const databasesApi = useDatabases();

  const messageOf = (error: unknown, fallback: string) =>
    (error as { message?: string }).message || fallback;

  const credentials = ref<DatabaseCredentials | null>(null);
  const credentialsLoading = ref(false);
  const credentialsError = ref('');
  const credentialsForbidden = ref(false);

  const loadCredentials = async () => {
    if (credentials.value) {
      return credentials.value;
    }

    if (credentialsLoading.value) {
      return null;
    }

    credentialsLoading.value = true;
    credentialsError.value = '';
    credentialsForbidden.value = false;

    try {
      const { credentials: loaded } = await databasesApi.credentials(props.database.id);
      credentials.value = loaded;

      return loaded;
    } catch (error) {
      credentialsForbidden.value = (error as { statusCode?: number }).statusCode === 403;
      credentialsError.value = messageOf(
        error,
        credentialsForbidden.value
          ? 'You do not have permission to view these credentials.'
          : 'Failed to load the credentials.',
      );

      return null;
    } finally {
      credentialsLoading.value = false;
    }
  };

  type SecretField = 'password' | 'connectionUri';

  const revealed = ref<Record<SecretField, boolean>>({ password: false, connectionUri: false });
  const copied = ref<Record<SecretField, boolean>>({ password: false, connectionUri: false });

  const toggleReveal = async (field: SecretField) => {
    if (revealed.value[field]) {
      revealed.value[field] = false;
      return;
    }

    const loaded = await loadCredentials();

    if (loaded) {
      revealed.value[field] = true;
    }
  };

  const copyField = async (field: SecretField) => {
    const loaded = await loadCredentials();

    if (!loaded) {
      return;
    }

    await navigator.clipboard.writeText(loaded[field]);
    copied.value[field] = true;
    setTimeout(() => (copied.value[field] = false), 2000);
  };

  const shownValue = (field: SecretField) =>
    revealed.value[field] && credentials.value ? credentials.value[field] : '••••••••';

  const networkNote = computed(() =>
    props.server
      ? `${props.database.connection.host} only resolves inside ${props.server.name}'s internal network — unreachable from outside the server.`
      : `${props.database.connection.host} only resolves inside the server's internal network — unreachable from outside the server.`,
  );
</script>

<template>
  <div class="flex max-w-205 flex-col gap-4.5">
    <Card title="Connection" rows>
      <Row as="div" class="flex items-center">
        <div class="w-33 shrink-0 text-caption text-ink-2">Host</div>
        <div class="truncate font-mono text-caption text-ink">{{ database.connection.host }}</div>
      </Row>
      <Row as="div" class="flex items-center">
        <div class="w-33 shrink-0 text-caption text-ink-2">Port</div>
        <div class="font-mono text-caption text-ink">{{ database.connection.port }}</div>
      </Row>
      <Row as="div" class="flex items-center">
        <div class="w-33 shrink-0 text-caption text-ink-2">Username</div>
        <div class="truncate font-mono text-caption text-ink">
          {{ database.connection.username }}
        </div>
      </Row>
      <Row as="div" class="flex items-center">
        <div class="w-33 shrink-0 text-caption text-ink-2">Database</div>
        <div class="truncate font-mono text-caption text-ink">
          {{ database.connection.database }}
        </div>
      </Row>

      <template #footer>
        <p class="text-caption text-ink-2">{{ networkNote }}</p>
      </template>
    </Card>

    <Card title="Credentials" content-class="p-0">
      <Alert v-if="credentialsError" theme="error" class="m-4.25">{{ credentialsError }}</Alert>

      <Row as="div" class="flex items-center">
        <div class="w-33 shrink-0 text-caption text-ink-2">Password</div>
        <div class="min-w-0 flex-1 truncate font-mono text-caption text-ink-2">
          {{ shownValue('password') }}
        </div>
        <div class="flex shrink-0 items-center gap-1">
          <Button
            theme="quiet"
            size="xs"
            :disabled="credentialsLoading"
            @click="toggleReveal('password')"
          >
            {{ revealed.password ? 'Hide' : 'Reveal' }}
          </Button>
          <button
            type="button"
            title="Copy password"
            class="cursor-pointer rounded-control p-1.5 text-ink-2 hover:bg-inset hover:text-ink"
            @click="copyField('password')"
          >
            <Icon :name="copied.password ? 'lucide:check' : 'lucide:copy'" class="size-3.5" />
          </button>
        </div>
      </Row>

      <Row as="div" class="flex items-center">
        <div class="w-33 shrink-0 text-caption text-ink-2">Connection URI</div>
        <div class="min-w-0 flex-1 truncate font-mono text-caption text-ink-2">
          {{ shownValue('connectionUri') }}
        </div>
        <div class="flex shrink-0 items-center gap-1">
          <Button
            theme="quiet"
            size="xs"
            :disabled="credentialsLoading"
            @click="toggleReveal('connectionUri')"
          >
            {{ revealed.connectionUri ? 'Hide' : 'Reveal' }}
          </Button>
          <button
            type="button"
            title="Copy connection URI"
            class="cursor-pointer rounded-control p-1.5 text-ink-2 hover:bg-inset hover:text-ink"
            @click="copyField('connectionUri')"
          >
            <Icon :name="copied.connectionUri ? 'lucide:check' : 'lucide:copy'" class="size-3.5" />
          </button>
        </div>
      </Row>

      <template #footer>
        <p class="text-caption text-ink-2">
          Values are only fetched when revealed or copied — never on page load.
        </p>
      </template>
    </Card>
  </div>
</template>
