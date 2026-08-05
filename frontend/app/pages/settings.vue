<script setup lang="ts">
  import { z } from 'zod';
  import {
    useGitSources,
    type GitInstallation,
    type GitSource,
  } from '~/composables/services/useGitSources';
  import { useOrganizations } from '~/composables/services/useOrganizations';
  import { useTeam, type Member } from '~/composables/services/useTeam';
  import type { OrganizationRole } from '~/stores/organization.store';

  useHead({ title: 'Settings' });

  const toast = useToast();
  const session = useSessionStore();
  const route = useRoute();
  const { current, update, remove } = useOrganizations();
  const {
    listMembers,
    updateMemberRole,
    removeMember,
    leave,
    listInvites,
    createInvite,
    revokeInvite,
  } = useTeam();
  const {
    list: listGitSources,
    startManifest,
    listInstallations,
    remove: removeGitSource,
  } = useGitSources();

  const canManage = computed(() => ['owner', 'admin'].includes(current.value?.role ?? ''));
  const isOwner = computed(() => current.value?.role === 'owner');

  type Tab = 'general' | 'team' | 'git' | 'danger';

  const TABS: { key: Tab; label: string }[] = [
    { key: 'general', label: 'General' },
    { key: 'team', label: 'Team' },
    { key: 'git', label: 'Git sources' },
    { key: 'danger', label: 'Danger zone' },
  ];

  const isTab = (value: unknown): value is Tab => TABS.some(tab => tab.key === value);

  const activeTab = ref<Tab>(isTab(route.query.tab) ? route.query.tab : 'general');

  const brandingForm = useSchemaForm(
    z.object({
      name: z.string().trim().min(2, 'At least 2 characters'),
      logo: z.string().trim().max(2048).optional(),
      favicon: z.string().trim().max(2048).optional(),
      primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Invalid color'),
      secondaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Invalid color'),
    }),
    { name: '', logo: '', favicon: '', primaryColor: '#3b82f6', secondaryColor: '#22c55e' },
    {
      onError: message => toast.error({ title: 'Error', message }),
      onInvalid: (_errors, lastError) => toast.error({ title: 'Error', message: lastError }),
    },
  );

  watch(
    current,
    organization => {
      if (organization) {
        brandingForm.values.name = organization.name;
        brandingForm.values.logo = organization.branding.logo ?? '';
        brandingForm.values.favicon = organization.branding.favicon ?? '';
        brandingForm.values.primaryColor = organization.branding.primaryColor ?? '#3b82f6';
        brandingForm.values.secondaryColor = organization.branding.secondaryColor ?? '#22c55e';
      }
    },
    { immediate: true },
  );

  const onSaveBranding = brandingForm.submit(async values => {
    if (!current.value) {
      return;
    }

    await update(current.value.id, {
      name: values.name,
      branding: {
        logo: values.logo || undefined,
        favicon: values.favicon || undefined,
        primaryColor: values.primaryColor,
        secondaryColor: values.secondaryColor,
      },
    });

    toast.success({ title: 'Success', message: 'Settings saved.' });
  });

  const empty = { items: [], total: 0, page: 1, size: 0, pages: 0 };

  const { data: membersData, refresh: refreshMembers } = await useAsyncData(
    'settings-members',
    () => (session.organizationId ? listMembers() : Promise.resolve(empty)),
    { server: false, watch: [() => session.organizationId], default: () => empty },
  );

  const members = computed(() => membersData.value?.items ?? []);
  const isSelf = (member: Member) => member.userId === session.user?.id;

  const roleOptions = [
    { value: 'owner', label: 'Owner' },
    { value: 'admin', label: 'Admin' },
    { value: 'member', label: 'Member' },
  ];

  const changeRole = async (member: Member, role: string) => {
    if (role === member.role) {
      return;
    }

    try {
      await updateMemberRole(member.userId, role as OrganizationRole);
      await refreshMembers();
    } catch (error) {
      toast.error({
        title: 'Error',
        message: (error as { message?: string }).message || 'Failed to change the role.',
      });
      await refreshMembers();
    }
  };

  const { data: invitesData, refresh: refreshInvites } = await useAsyncData(
    'settings-invites',
    () => (session.organizationId && canManage.value ? listInvites() : Promise.resolve(empty)),
    { server: false, watch: [() => session.organizationId, canManage], default: () => empty },
  );

  const invites = computed(() => invitesData.value?.items ?? []);

  const inviteRoleOptions = [
    { value: 'member', label: 'Member' },
    { value: 'admin', label: 'Admin' },
  ];

  const inviteForm = useSchemaForm(
    z.object({
      email: z.email('Enter a valid email'),
      role: z.enum(['admin', 'member']),
    }),
    { email: '', role: 'member' as 'admin' | 'member' },
    {
      onError: message => toast.error({ title: 'Error', message }),
      onInvalid: (_errors, lastError) => toast.error({ title: 'Error', message: lastError }),
    },
  );

  const onInvite = inviteForm.submit(async values => {
    await createInvite(values.email, values.role);
    await refreshInvites();
    inviteForm.reset();
  });

  const revokingInvite = ref('');

  const onRevokeInvite = async (inviteId: string) => {
    revokingInvite.value = inviteId;

    try {
      await revokeInvite(inviteId);
      await refreshInvites();
    } catch (error) {
      toast.error({
        title: 'Error',
        message: (error as { message?: string }).message || 'Failed to revoke.',
      });
    } finally {
      revokingInvite.value = '';
    }
  };

  const formatDate = (value: string) => new Date(value).toLocaleDateString('en-US');

  const emptyGitSources = { items: [], total: 0, page: 1, size: 0, pages: 0 };

  const {
    data: gitSourcesData,
    refresh: refreshGitSources,
    status: gitSourcesStatus,
    error: gitSourcesLoadError,
  } = await useAsyncData(
    'settings-git-sources',
    () => (session.organizationId ? listGitSources() : Promise.resolve(emptyGitSources)),
    { server: false, watch: [() => session.organizationId], default: () => emptyGitSources },
  );

  const gitSources = computed(() => gitSourcesData.value?.items ?? []);
  const gitSourcesError = computed(
    () =>
      (gitSourcesLoadError.value as { message?: string } | null)?.message ||
      (gitSourcesLoadError.value ? 'Could not load the git sources.' : ''),
  );

  type InstallationState = { loading: boolean; items: GitInstallation[]; error: string };

  const installationsBySource = reactive<Record<string, InstallationState>>({});

  const loadInstallations = async (gitSourceId: string) => {
    installationsBySource[gitSourceId] = { loading: true, items: [], error: '' };

    try {
      const { items } = await listInstallations(gitSourceId);
      installationsBySource[gitSourceId] = { loading: false, items, error: '' };
    } catch (error) {
      installationsBySource[gitSourceId] = {
        loading: false,
        items: [],
        error: (error as { message?: string }).message || 'Could not load installations.',
      };
    }
  };

  watch(
    gitSources,
    sources => {
      for (const source of sources) {
        if (source.status === 'active' && !installationsBySource[source.id]) {
          loadInstallations(source.id);
        }
      }
    },
    { immediate: true },
  );

  const connectOpen = ref(false);

  const connectForm = useSchemaForm(
    z.object({
      name: z.string().trim().min(1, 'Enter a name'),
      organization: z.string().trim().optional(),
    }),
    { name: '', organization: '' },
    {
      onError: message => toast.error({ title: 'Error', message }),
      onInvalid: (_errors, lastError) => toast.error({ title: 'Error', message: lastError }),
    },
  );

  const openConnect = () => {
    connectForm.reset();
    connectOpen.value = true;
  };

  const submitManifestForm = (postUrl: string, manifest: Record<string, unknown>) => {
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = postUrl;
    form.style.display = 'none';

    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = 'manifest';
    input.value = JSON.stringify(manifest);

    form.appendChild(input);
    document.body.appendChild(form);
    form.submit();
  };

  const handleConnect = connectForm.submit(async values => {
    const result = await startManifest({
      name: values.name,
      organization: values.organization || undefined,
    });

    connectOpen.value = false;
    submitManifestForm(result.postUrl, result.manifest);
  });

  const toRemoveSource = ref<GitSource | null>(null);
  const confirmRemoveSourceOpen = ref(false);
  const removingSource = ref(false);

  const askRemoveSource = (source: GitSource) => {
    toRemoveSource.value = source;
    confirmRemoveSourceOpen.value = true;
  };

  const runRemoveSource = async () => {
    if (!toRemoveSource.value) {
      return;
    }

    removingSource.value = true;

    try {
      await removeGitSource(toRemoveSource.value.id);
      await refreshGitSources();
      confirmRemoveSourceOpen.value = false;
      toRemoveSource.value = null;
    } catch (error) {
      toast.error({
        title: 'Error',
        message: (error as { message?: string }).message || 'Failed to remove the git source.',
      });
    } finally {
      removingSource.value = false;
    }
  };

  const removingMember = ref<{ member: Member } | { leaving: true } | null>(null);
  const confirmMemberOpen = ref(false);
  const memberActionLoading = ref(false);

  const askRemoveMember = (member: Member) => {
    removingMember.value = { member };
    confirmMemberOpen.value = true;
  };

  const askLeave = () => {
    removingMember.value = { leaving: true };
    confirmMemberOpen.value = true;
  };

  const memberConfirmMessage = computed(() => {
    if (!removingMember.value) {
      return '';
    }

    if ('leaving' in removingMember.value) {
      return `You will lose access to ${current.value?.name}. Do you want to continue?`;
    }

    const member = removingMember.value.member;

    return `Remove ${member.name ?? member.email} from the organization?`;
  });

  const runMemberAction = async () => {
    if (!removingMember.value) {
      return;
    }

    memberActionLoading.value = true;

    try {
      if ('leaving' in removingMember.value) {
        await leave();
        confirmMemberOpen.value = false;
        removingMember.value = null;
        await navigateTo('/');
        return;
      }

      await removeMember(removingMember.value.member.userId);
      await refreshMembers();
      confirmMemberOpen.value = false;
      removingMember.value = null;
    } catch (error) {
      toast.error({
        title: 'Error',
        message: (error as { message?: string }).message || 'Could not complete.',
      });
    } finally {
      memberActionLoading.value = false;
    }
  };

  const confirmDeleteOpen = ref(false);
  const deleting = ref(false);

  const onDeleteOrganization = async () => {
    if (!current.value) {
      return;
    }

    deleting.value = true;

    try {
      await remove(current.value.id);
      confirmDeleteOpen.value = false;
      await navigateTo('/');
    } catch (error) {
      toast.error({
        title: 'Error',
        message: (error as { message?: string }).message || 'Failed to delete the organization.',
      });
    } finally {
      deleting.value = false;
    }
  };
</script>

<template>
  <Content>
    <Header title="Settings" description="Organization name, branding and team." />

    <Card v-if="!current" title="Select an organization">
      <p class="text-sm text-content-muted">
        Choose or create an organization in the sidebar selector.
      </p>
    </Card>

    <div v-else class="flex flex-col gap-6">
      <div class="flex gap-1 border-b border-surface-line">
        <button
          v-for="tab in TABS"
          :key="tab.key"
          type="button"
          class="cursor-pointer border-b-2 px-3 py-2 text-sm transition-colors"
          :class="
            activeTab === tab.key
              ? 'border-primary text-content-strong'
              : 'border-transparent text-content-muted hover:text-content-strong'
          "
          @click="activeTab = tab.key"
        >
          {{ tab.label }}
        </button>
      </div>

      <template v-if="activeTab === 'general'">
        <Card v-if="!canManage" title="Branding">
          <p class="text-sm text-content-muted">
            Only administrators can change the organization settings.
          </p>
        </Card>

        <Card v-else title="Branding">
          <form class="flex flex-col gap-4" @submit.prevent="onSaveBranding">
            <Input
              v-model="brandingForm.values.name"
              label="Name"
              :call-error="brandingForm.errors.value.name"
            />

            <div class="grid gap-4 sm:grid-cols-2">
              <Input
                v-model="brandingForm.values.logo"
                label="Logo URL"
                placeholder="https://…/logo.png"
                :call-error="brandingForm.errors.value.logo"
              />
              <Input
                v-model="brandingForm.values.favicon"
                label="Favicon URL"
                placeholder="https://…/favicon.ico"
                :call-error="brandingForm.errors.value.favicon"
              />
              <Input
                v-model="brandingForm.values.primaryColor"
                label="Primary color"
                type="color"
                :call-error="brandingForm.errors.value.primaryColor"
              />
              <Input
                v-model="brandingForm.values.secondaryColor"
                label="Secondary color"
                type="color"
                :call-error="brandingForm.errors.value.secondaryColor"
              />
            </div>

            <p class="text-xs text-content-muted">
              Color and name changes apply to the entire interface as soon as you save.
            </p>

            <div class="flex justify-end">
              <Button theme="primary" type="submit" :disabled="brandingForm.loading.value">
                <Icon v-if="brandingForm.loading.value" name="svg-spinners:tadpole" size="16" />
                Save
              </Button>
            </div>
          </form>
        </Card>
      </template>

      <template v-else-if="activeTab === 'team'">
        <Card title="Members">
          <ul class="flex flex-col divide-y divide-surface-line">
            <li v-for="member in members" :key="member.userId" class="flex items-center gap-3 py-3">
              <span
                class="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-medium text-white"
              >
                {{ (member.name || member.email || '?').charAt(0).toUpperCase() }}
              </span>

              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium text-content-strong">
                  {{ member.name ?? member.email }}
                  <span v-if="isSelf(member)" class="text-xs text-content-muted">(you)</span>
                </p>
                <p class="truncate text-xs text-content-muted">{{ member.email }}</p>
              </div>

              <div class="w-32 shrink-0">
                <Select
                  v-if="canManage && !(isSelf(member) && !isOwner)"
                  :model-value="member.role"
                  :options="roleOptions"
                  @update:model-value="role => changeRole(member, role as string)"
                />
                <Tag v-else color="blue" class="capitalize">{{ member.role }}</Tag>
              </div>

              <div class="w-9 shrink-0">
                <button
                  v-if="isSelf(member)"
                  type="button"
                  title="Leave the organization"
                  class="cursor-pointer rounded-lg p-2 text-content-muted transition-colors hover:bg-surface-hover hover:text-danger"
                  @click="askLeave"
                >
                  <Icon name="lucide:log-out" class="size-4" />
                </button>
                <button
                  v-else-if="canManage"
                  type="button"
                  title="Remove member"
                  class="cursor-pointer rounded-lg p-2 text-content-muted transition-colors hover:bg-surface-hover hover:text-danger"
                  @click="askRemoveMember(member)"
                >
                  <Icon name="lucide:user-minus" class="size-4" />
                </button>
              </div>
            </li>
          </ul>
        </Card>

        <Card v-if="canManage" title="Invites" description="Invite people by email.">
          <form class="flex flex-col gap-3 sm:flex-row sm:items-start" @submit.prevent="onInvite">
            <div class="flex-1">
              <Input
                v-model="inviteForm.values.email"
                type="email"
                placeholder="colleague@company.com"
                :call-error="inviteForm.errors.value.email"
              />
            </div>
            <div class="w-full sm:w-40">
              <Select v-model="inviteForm.values.role" :options="inviteRoleOptions" />
            </div>
            <Button theme="primary" type="submit" :disabled="inviteForm.loading.value">
              <Icon v-if="inviteForm.loading.value" name="svg-spinners:tadpole" size="16" />
              Invite
            </Button>
          </form>

          <ul v-if="invites.length" class="mt-4 flex flex-col divide-y divide-surface-line">
            <li v-for="invite in invites" :key="invite.id" class="flex items-center gap-3 py-3">
              <Icon name="lucide:mail" class="size-4 shrink-0 text-content-muted" />
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm">{{ invite.email }}</p>
                <p class="text-xs text-content-muted">
                  expires on {{ formatDate(invite.expiresAt) }}
                </p>
              </div>
              <Tag class="capitalize">{{ invite.role }}</Tag>
              <button
                type="button"
                title="Revoke invite"
                :disabled="revokingInvite === invite.id"
                class="cursor-pointer rounded-lg p-2 text-content-muted transition-colors hover:bg-surface-hover hover:text-danger disabled:opacity-60"
                @click="onRevokeInvite(invite.id)"
              >
                <Icon
                  :name="revokingInvite === invite.id ? 'svg-spinners:tadpole' : 'lucide:x'"
                  class="size-4"
                />
              </button>
            </li>
          </ul>

          <p v-else class="mt-4 text-sm text-content-muted">No pending invites.</p>
        </Card>
      </template>

      <template v-else-if="activeTab === 'git'">
        <Card title="Git sources" description="Connect a GitHub App once, per organization.">
          <template v-if="canManage" #right>
            <Button theme="primary" @click="openConnect">
              <Icon name="proicons:add" size="18" />
              Connect GitHub
            </Button>
          </template>

          <div v-if="gitSourcesStatus === 'pending'" class="flex flex-col gap-3">
            <Skeleton class="h-20 w-full" />
            <Skeleton class="h-20 w-full" />
          </div>

          <Alert v-else-if="gitSourcesError" theme="error">{{ gitSourcesError }}</Alert>

          <div
            v-else-if="!gitSources.length"
            class="flex flex-col items-center gap-3 rounded-xl border border-dashed border-field-border bg-surface-sunken px-6 py-12 text-center"
          >
            <Icon name="mdi:github" class="size-8 text-content-dim" />
            <div>
              <h3 class="text-content-strong">No git source connected</h3>
              <p class="mt-1 text-sm text-content-muted">
                Connect a GitHub App to create applications by picking a repository, without pasting
                a token.
              </p>
            </div>
          </div>

          <ul v-else class="flex flex-col divide-y divide-surface-line">
            <li v-for="source in gitSources" :key="source.id" class="flex flex-col gap-3 py-4">
              <div class="flex flex-wrap items-center gap-2">
                <h3 class="truncate text-content-strong">{{ source.name }}</h3>
                <Tag :color="source.status === 'active' ? 'green' : 'default'" class="capitalize">
                  {{ source.status }}
                </Tag>
              </div>

              <p v-if="source.status === 'pending'" class="text-sm text-content-muted">
                Waiting for the confirmation on GitHub.
              </p>

              <template v-else>
                <div v-if="installationsBySource[source.id]?.loading" class="flex flex-col gap-2">
                  <Skeleton class="h-10 w-full" />
                </div>

                <Alert v-else-if="installationsBySource[source.id]?.error" theme="error">
                  {{ installationsBySource[source.id]?.error }}
                </Alert>

                <p
                  v-else-if="!installationsBySource[source.id]?.items.length"
                  class="text-sm text-content-muted"
                >
                  No installation yet.
                </p>

                <ul v-else class="flex flex-col gap-2">
                  <li
                    v-for="installation in installationsBySource[source.id]?.items"
                    :key="installation.id"
                    class="flex items-center gap-2 rounded-lg bg-surface-sunken px-3 py-2 text-sm"
                  >
                    <Icon
                      :name="
                        installation.accountType === 'Organization'
                          ? 'lucide:building-2'
                          : 'lucide:user'
                      "
                      class="size-4 shrink-0 text-content-muted"
                    />
                    <span class="truncate">{{ installation.account }}</span>
                    <Tag class="ml-auto shrink-0">
                      {{
                        installation.repositorySelection === 'all'
                          ? 'all repositories'
                          : 'selected repositories'
                      }}
                    </Tag>
                  </li>
                </ul>
              </template>

              <div v-if="canManage" class="flex items-center gap-2">
                <Button
                  v-if="source.htmlUrl"
                  theme="secondary"
                  :to="source.htmlUrl"
                  target="_blank"
                  rel="noopener"
                >
                  <Icon name="lucide:external-link" class="size-4" />
                  Install / manage on GitHub
                </Button>
                <Button theme="ghost" @click="askRemoveSource(source)">
                  <Icon name="lucide:trash-2" class="size-4" />
                  Remove
                </Button>
              </div>
            </li>
          </ul>
        </Card>
      </template>

      <template v-else-if="activeTab === 'danger'">
        <Card v-if="!isOwner" title="Danger zone">
          <p class="text-sm text-content-muted">Only the owner can delete the organization.</p>
        </Card>

        <Card v-else title="Danger zone">
          <div class="flex items-center justify-between gap-4">
            <p class="text-sm text-content-muted">
              Deletes this organization: every project, application, server and database inside it.
              This cannot be undone.
            </p>
            <Button theme="danger" @click="confirmDeleteOpen = true">Delete organization</Button>
          </div>
        </Card>
      </template>
    </div>

    <Confirm
      v-if="removingMember"
      v-model:open="confirmMemberOpen"
      :title="'leaving' in removingMember ? 'Leave the organization' : 'Remove member'"
      :message="memberConfirmMessage"
      :confirm-label="'leaving' in removingMember ? 'Leave' : 'Remove'"
      danger
      :loading="memberActionLoading"
      @confirm="runMemberAction"
    />

    <Confirm
      v-if="current"
      v-model:open="confirmDeleteOpen"
      title="Delete organization"
      :message="`This permanently deletes “${current.name}” and everything inside it: projects, applications, servers and databases.`"
      confirm-label="Delete"
      :confirm-text="current.name"
      danger
      :loading="deleting"
      @confirm="onDeleteOrganization"
    />

    <Confirm
      v-if="toRemoveSource"
      v-model:open="confirmRemoveSourceOpen"
      title="Remove git source"
      :message="`Remove “${toRemoveSource.name}”? Applications using it must be removed first.`"
      confirm-label="Remove"
      danger
      :loading="removingSource"
      @confirm="runRemoveSource"
    />

    <Modal :open="connectOpen" @on-close-modal="connectOpen = false">
      <Card
        title="Connect GitHub"
        class="w-md max-w-full"
        close-button
        @on-close="connectOpen = false"
      >
        <form class="flex flex-col gap-4" @submit.prevent="handleConnect">
          <Input
            v-model="connectForm.values.name"
            label="App name"
            placeholder="zydock-acme"
            :call-error="connectForm.errors.value.name"
          />
          <Input
            v-model="connectForm.values.organization"
            label="GitHub organization (optional)"
            placeholder="acme-corp"
            :call-error="connectForm.errors.value.organization"
          />

          <p class="text-xs text-content-muted">
            You'll be taken to GitHub to confirm the app. Leave the organization empty to create it
            under your personal account.
          </p>

          <div class="flex items-center justify-end gap-2">
            <Button theme="ghost" type="button" @click="connectOpen = false">Cancel</Button>
            <Button theme="primary" type="submit" :disabled="connectForm.loading.value">
              <Icon v-if="connectForm.loading.value" name="svg-spinners:tadpole" size="16" />
              Continue on GitHub
            </Button>
          </div>
        </form>
      </Card>
    </Modal>
  </Content>
</template>
