<script setup lang="ts">
  import { useApplications, type Application } from '~/composables/services/useApplications';

  const props = defineProps<{ application: Application }>();

  const git = computed(() => props.application.git!);
  const emit = defineEmits<{ refresh: [] }>();

  const applicationsApi = useApplications();

  const messageOf = (error: unknown, fallback: string) =>
    (error as { message?: string }).message || fallback;

  const webhookBusy = ref(false);
  const webhookCopied = ref(false);
  const webhookError = ref('');

  const handleConfigureWebhook = async () => {
    webhookError.value = '';
    webhookBusy.value = true;

    try {
      await applicationsApi.configureWebhook(props.application.id);
      emit('refresh');
    } catch (error) {
      webhookError.value = messageOf(error, 'Failed to configure the webhook.');
    } finally {
      webhookBusy.value = false;
    }
  };

  const handleRemoveWebhook = async () => {
    webhookError.value = '';
    webhookBusy.value = true;

    try {
      await applicationsApi.removeWebhook(props.application.id);
      emit('refresh');
    } catch (error) {
      webhookError.value = messageOf(error, 'Failed to remove the webhook.');
    } finally {
      webhookBusy.value = false;
    }
  };

  const copyWebhookUrl = async () => {
    if (!git.value.webhookUrl) {
      return;
    }

    await navigator.clipboard.writeText(git.value.webhookUrl);
    webhookCopied.value = true;
    setTimeout(() => (webhookCopied.value = false), 2000);
  };

  const editingToken = ref(false);
  const tokenDraft = ref('');
  const savingToken = ref(false);
  const tokenError = ref('');

  const startEditToken = () => {
    tokenDraft.value = '';
    tokenError.value = '';
    editingToken.value = true;
  };

  const saveToken = async (token: string | null) => {
    tokenError.value = '';
    savingToken.value = true;

    try {
      await applicationsApi.update(props.application.id, { git: { token } });

      editingToken.value = false;
      emit('refresh');
    } catch (error) {
      tokenError.value = messageOf(error, 'Failed to save the token.');
    } finally {
      savingToken.value = false;
    }
  };
</script>

<template>
  <Card v-if="git.source === 'github-app'" title="Git webhook">
    <p class="text-[13px] leading-relaxed text-ink-2">
      This application comes from a GitHub App source, so the webhook is already installed and
      shared by every application on that source.
      <NuxtLink to="/settings?tab=git" class="text-accent hover:underline">
        Open git source
      </NuxtLink>
    </p>
  </Card>

  <template v-else>
    <Card title="Git webhook" content-class="p-0">
      <template #right>
        <Button
          v-if="!git.hasWebhook"
          theme="secondary"
          size="xs"
          :disabled="webhookBusy"
          @click="handleConfigureWebhook"
        >
          <Icon v-if="webhookBusy" name="svg-spinners:tadpole" size="14" />
          Configure webhook
        </Button>
      </template>

      <div class="flex flex-col gap-3 p-4.25">
        <Alert v-if="webhookError" theme="error">{{ webhookError }}</Alert>

        <div class="flex items-center gap-2 text-[13px]">
          <Tag :color="git.hasWebhook ? 'live' : 'default'">
            {{ git.hasWebhook ? 'Configured' : 'Not configured' }}
          </Tag>
          <span class="text-ink-2">
            {{
              git.hasWebhook
                ? 'GitHub notifies this URL on every push, triggering auto-deploy.'
                : 'Without it, auto-deploy only runs if the webhook is set up manually on the repository.'
            }}
          </span>
        </div>

        <div v-if="git.hasWebhook && git.webhookUrl" class="flex items-center gap-2">
          <code
            class="flex-1 truncate rounded-control border border-edge bg-inset px-3 py-2 text-caption"
          >
            {{ git.webhookUrl }}
          </code>
          <Button theme="quiet" size="xs" type="button" @click="copyWebhookUrl">
            <Icon :name="webhookCopied ? 'lucide:check' : 'lucide:copy'" class="size-3.5" />
            {{ webhookCopied ? 'Copied' : 'Copy' }}
          </Button>
        </div>

        <Alert v-if="!git.hasWebhook && git.autoDeploy" theme="info">
          Auto-deploy is enabled but no webhook is configured — configure it above so pushes deploy
          automatically.
        </Alert>

        <div v-if="git.hasWebhook" class="flex justify-end">
          <Button theme="quiet" size="xs" :disabled="webhookBusy" @click="handleRemoveWebhook">
            Remove webhook
          </Button>
        </div>
      </div>
    </Card>

    <Card title="Access token" content-class="p-0">
      <template #right>
        <Button v-if="!editingToken" theme="secondary" size="xs" @click="startEditToken">
          {{ git.hasToken ? 'Replace' : 'Set' }}
        </Button>
      </template>

      <div v-if="!editingToken" class="flex items-center gap-2 p-4.25 text-[13px]">
        <Tag :color="git.hasToken ? 'live' : 'default'">
          {{ git.hasToken ? 'Configured' : 'Not configured' }}
        </Tag>
        <span class="text-ink-2">
          {{
            git.hasToken
              ? 'The platform clones the private repository with this token.'
              : 'Required only for private repositories.'
          }}
        </span>
        <button
          v-if="git.hasToken"
          type="button"
          class="ml-auto cursor-pointer text-caption text-ink-2 hover:text-failed"
          :disabled="savingToken"
          @click="saveToken(null)"
        >
          Remove
        </button>
      </div>

      <div v-else class="flex flex-col">
        <Alert v-if="tokenError" theme="error" class="mx-4.25 mt-3">{{ tokenError }}</Alert>
        <div data-rows class="flex flex-col">
          <Input
            v-model="tokenDraft"
            label="Token"
            password
            placeholder="Personal access token"
            mono
            boxed
          />
        </div>
        <div class="flex flex-wrap items-center gap-2 px-4.25 py-3.25">
          <p class="text-caption text-ink-3">
            Repository read scope. Stored encrypted; never shown again.
          </p>

          <div class="ml-auto flex items-center gap-2">
            <Button theme="quiet" size="sm" @click="editingToken = false">Cancel</Button>
            <Button
              theme="primary"
              size="sm"
              :disabled="savingToken || !tokenDraft"
              @click="saveToken(tokenDraft)"
            >
              <Icon v-if="savingToken" name="svg-spinners:tadpole" size="16" />
              Save
            </Button>
          </div>
        </div>
      </div>
    </Card>
  </template>
</template>
