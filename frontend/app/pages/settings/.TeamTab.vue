<script setup lang="ts">
  import { z } from 'zod';
  import { useTeam, type Member } from '~/composables/services/useTeam';
  import type { Organization, OrganizationRole } from '~/stores/organization.store';

  const props = defineProps<{ organization: Organization; canManage: boolean; isOwner: boolean }>();

  const toast = useToast();
  const session = useSessionStore();
  const {
    listMembers,
    updateMemberRole,
    removeMember,
    leave,
    listInvites,
    createInvite,
    revokeInvite,
  } = useTeam();

  const empty = { items: [], total: 0, page: 1, size: 0, pages: 0 };

  const { data: membersData, refresh: refreshMembers } = await useAsyncData(
    () => `settings-members-${props.organization.id}`,
    () => listMembers(),
    { server: false, default: () => empty },
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
    () => `settings-invites-${props.organization.id}`,
    () => (props.canManage ? listInvites() : Promise.resolve(empty)),
    { server: false, watch: [() => props.canManage], default: () => empty },
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
      return `You will lose access to ${props.organization.name}. Do you want to continue?`;
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
</script>

<template>
  <div class="flex flex-col gap-4.5">
    <Card title="Members" content-class="p-0">
      <Row
        v-for="member in members"
        :key="member.userId"
        as="div"
        class="flex items-center gap-3.5"
      >
        <Avatar :name="member.name || member.email || '?'" />
        <div class="min-w-0 flex-1">
          <div class="truncate text-[13.5px] text-ink">
            {{ member.name ?? member.email }}
            <span v-if="isSelf(member)" class="text-caption text-ink-2">(you)</span>
          </div>
          <div class="truncate text-caption text-ink-2">{{ member.email }}</div>
        </div>
        <Select
          v-if="canManage && !(isSelf(member) && !isOwner)"
          :model-value="member.role"
          :options="roleOptions"
          class="w-32"
          @update:model-value="role => changeRole(member, role as string)"
        />
        <Tag v-else class="capitalize">{{ member.role }}</Tag>
        <button
          v-if="isSelf(member)"
          type="button"
          title="Leave the organization"
          class="cursor-pointer rounded-control p-1.5 text-ink-2 hover:bg-inset hover:text-failed"
          @click="askLeave"
        >
          <Icon name="lucide:log-out" class="size-4" />
        </button>
        <button
          v-else-if="canManage"
          type="button"
          title="Remove member"
          class="cursor-pointer rounded-control p-1.5 text-ink-2 hover:bg-inset hover:text-failed"
          @click="askRemoveMember(member)"
        >
          <Icon name="lucide:user-minus" class="size-4" />
        </button>
      </Row>
    </Card>

    <Card v-if="canManage" title="Invite by email">
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

      <ul v-if="invites.length" class="mt-4 flex flex-col divide-y divide-hairline">
        <li v-for="invite in invites" :key="invite.id" class="flex items-center gap-3 py-3">
          <Icon name="lucide:mail" class="size-4 shrink-0 text-ink-2" />
          <div class="min-w-0 flex-1">
            <p class="truncate text-[13.5px] text-ink">{{ invite.email }}</p>
            <p class="text-caption text-ink-2">expires on {{ formatDate(invite.expiresAt) }}</p>
          </div>
          <Tag class="capitalize">{{ invite.role }}</Tag>
          <button
            type="button"
            title="Revoke invite"
            :disabled="revokingInvite === invite.id"
            class="cursor-pointer rounded-control p-1.5 text-ink-2 hover:bg-inset hover:text-failed disabled:opacity-60"
            @click="onRevokeInvite(invite.id)"
          >
            <Icon
              :name="revokingInvite === invite.id ? 'svg-spinners:tadpole' : 'lucide:x'"
              class="size-4"
            />
          </button>
        </li>
      </ul>

      <p v-else class="mt-4 text-[13px] text-ink-2">No pending invites.</p>
    </Card>

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
  </div>
</template>
