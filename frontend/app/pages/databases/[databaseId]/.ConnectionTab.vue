<script setup lang="ts">
  import {
    useDatabases,
    type Database,
    type DatabaseCredentials,
  } from '~/composables/services/useDatabases';
  import type { Server } from '~/composables/services/useServers';

  const props = defineProps<{ database: Database; server?: Server | null }>();
  const emit = defineEmits<{ refresh: [] }>();

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

  type SecretField = 'password' | 'connectionUri' | 'publicConnectionUri';

  type SecretFlags = Record<SecretField, boolean>;

  const secretFlags = (): SecretFlags => ({
    password: false,
    connectionUri: false,
    publicConnectionUri: false,
  });

  const revealed = ref<SecretFlags>(secretFlags());
  const copied = ref<SecretFlags>(secretFlags());

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

  const copyToClipboard = async (value: string) => {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(value);
      return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();

    try {
      document.execCommand('copy');
    } finally {
      textarea.remove();
    }
  };

  const copyField = async (field: SecretField) => {
    const loaded = await loadCredentials();
    const value = loaded?.[field];

    if (!value) {
      return;
    }

    try {
      await copyToClipboard(value);
      copied.value[field] = true;
      setTimeout(() => (copied.value[field] = false), 2000);
    } catch (error) {
      credentialsError.value = messageOf(error, 'Failed to copy to the clipboard.');
    }
  };

  const shownValue = (field: SecretField) =>
    (revealed.value[field] && credentials.value?.[field]) || '••••••••';

  const isManaged = computed(() => props.database.source === 'managed');

  const publicEnabled = computed(() => props.database.publicAccess.enabled);

  const externalAddress = computed(() =>
    props.database.externalHost && props.database.externalPort
      ? `${props.database.externalHost}:${props.database.externalPort}`
      : null,
  );

  /**
   * Rendered straight from the serialized database — the password comes masked from the API, so
   * showing the string costs no secret. `Copy` is what fetches the real one.
   */
  const publicUriMasked = computed(() => props.database.publicConnectionUriMasked ?? null);

  const accessError = ref('');
  const accessSaving = ref(false);
  const confirmAccessOpen = ref(false);

  /** What the pending confirmation would set the switch to. */
  const pendingEnabled = ref(false);
  const hostPortDraft = ref('');

  const handlePublicToggle = (value: boolean) => {
    accessError.value = '';
    pendingEnabled.value = value;
    hostPortDraft.value = String(
      props.database.publicAccess.hostPort ?? props.database.connection.port,
    );
    confirmAccessOpen.value = true;
  };

  const applyAccess = async () => {
    const hostPort = Number(hostPortDraft.value);

    if (
      pendingEnabled.value &&
      (!hostPort || !Number.isInteger(hostPort) || hostPort < 1024 || hostPort > 65535)
    ) {
      accessError.value = 'The port must be a whole number between 1024 and 65535.';
      return;
    }

    accessError.value = '';
    accessSaving.value = true;

    try {
      await databasesApi.updateAccess(props.database.id, {
        enabled: pendingEnabled.value,
        hostPort: pendingEnabled.value ? hostPort : undefined,
      });

      credentials.value = null;
      revealed.value = secretFlags();
      confirmAccessOpen.value = false;
      emit('refresh');
    } catch (error) {
      confirmAccessOpen.value = false;
      accessError.value = messageOf(error, 'Failed to update the public endpoint.');
    } finally {
      accessSaving.value = false;
    }
  };

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

    <Card
      v-if="isManaged"
      title="Public endpoint"
      description="Only apps inside this project can reach the private host. Turn this on to expose the connection string to clients outside the project."
      content-class="p-0"
    >
      <template #right>
        <div class="flex justify-end">
          <Switch :model-value="publicEnabled" @update:model-value="handlePublicToggle" />
        </div>
      </template>

      <Alert v-if="accessError && !confirmAccessOpen" theme="error" class="m-4.25">
        {{ accessError }}
      </Alert>
      <Alert v-if="credentialsError" theme="error" class="m-4.25">{{ credentialsError }}</Alert>

      <template v-if="publicEnabled">
        <div data-row class="border-t border-hairline px-4.25 py-3.25 first:border-t-0">
          <div class="flex items-center gap-4.25">
            <div class="min-w-0 flex-1 text-caption text-ink-2">Public connection string</div>
            <Button
              theme="secondary"
              size="xs"
              :disabled="credentialsLoading || !publicUriMasked"
              @click="copyField('publicConnectionUri')"
            >
              {{ copied.publicConnectionUri ? 'Copied' : 'Copy' }}
            </Button>
          </div>

          <p class="mt-2.5 font-mono text-caption break-all text-ink">
            {{ publicUriMasked ?? '—' }}
          </p>
        </div>

        <Row as="div" class="flex items-center">
          <div class="w-33 shrink-0 text-caption text-ink-2">Address</div>
          <div class="min-w-0 flex-1 font-mono text-caption break-all text-ink">
            {{ externalAddress ?? '—' }}
          </div>
        </Row>

        <p
          v-if="!externalAddress"
          class="border-t border-hairline px-4.25 py-3.25 text-caption text-ink-2"
        >
          This server has no known public IP or SSH host, so no reachable address can be shown yet.
        </p>

        <div class="px-4.25 pb-4.25">
          <Alert theme="warning">
            The port is open to the whole internet. Use a strong password and keep the server's
            firewall in mind.
          </Alert>
        </div>
      </template>

      <Confirm
        v-model:open="confirmAccessOpen"
        :title="pendingEnabled ? 'Enable public endpoint' : 'Disable public endpoint'"
        :message="
          pendingEnabled
            ? 'This recreates the database container to publish the port below. The data is kept on its volume.'
            : 'This recreates the database container to remove the published port. The data is kept on its volume.'
        "
        :confirm-label="pendingEnabled ? 'Enable' : 'Disable'"
        :danger="pendingEnabled"
        :loading="accessSaving"
        @confirm="applyAccess"
      >
        <Input
          v-if="pendingEnabled"
          v-model="hostPortDraft"
          class="mt-4"
          label="Host port"
          placeholder="5432"
          mono
          boxed
          bare
        />

        <Alert v-if="accessError" theme="error" class="mt-4">{{ accessError }}</Alert>
      </Confirm>
    </Card>
  </div>
</template>
