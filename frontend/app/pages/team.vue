<script setup lang="ts">
  import { z } from 'zod';
  import type { Member } from '~/composables/use-team';
  import type { OrganizationRole } from '~/stores/organization.store';

  useHead({ title: 'Time' });

  const session = useSessionStore();
  const { current, load } = useOrganizations();
  const {
    listMembers,
    updateMemberRole,
    removeMember,
    leave,
    listInvites,
    createInvite,
    revokeInvite,
  } = useTeam();

  const canManage = computed(() => ['owner', 'admin'].includes(current.value?.role ?? ''));
  const isOwner = computed(() => current.value?.role === 'owner');

  const empty = { items: [], total: 0, page: 1, size: 0, pages: 0 };
  const actionError = ref('');

  const roleOptions = [
    { value: 'owner', label: 'Owner' },
    { value: 'admin', label: 'Admin' },
    { value: 'member', label: 'Member' },
  ];

  const inviteRoleOptions = [
    { value: 'member', label: 'Member' },
    { value: 'admin', label: 'Admin' },
  ];

  // --- Membros -----------------------------------------------------------------------------------

  const { data: membersData, refresh: refreshMembers } = await useAsyncData(
    'members',
    () => (session.organizationId ? listMembers() : Promise.resolve(empty)),
    { server: false, watch: [() => session.organizationId], default: () => empty },
  );

  const members = computed(() => membersData.value?.items ?? []);
  const isSelf = (member: Member) => member.userId === session.user?.id;

  const changeRole = async (member: Member, role: string) => {
    if (role === member.role) {
      return;
    }

    actionError.value = '';

    try {
      await updateMemberRole(member.userId, role as OrganizationRole);
      await refreshMembers();
    } catch (error) {
      actionError.value = (error as { message?: string }).message || 'Falha ao alterar o papel.';
      await refreshMembers();
    }
  };

  // --- Convites ----------------------------------------------------------------------------------

  const { data: invitesData, refresh: refreshInvites } = await useAsyncData(
    'invites',
    () => (session.organizationId && canManage.value ? listInvites() : Promise.resolve(empty)),
    { server: false, watch: [() => session.organizationId, canManage], default: () => empty },
  );

  const invites = computed(() => invitesData.value?.items ?? []);

  const inviteForm = useForm(
    z.object({
      email: z.email('Informe um e-mail válido'),
      role: z.enum(['admin', 'member']),
    }),
    { email: '', role: 'member' as 'admin' | 'member' },
  );

  const onInvite = inviteForm.submit(async data => {
    await createInvite(data.email, data.role);
    await refreshInvites();
    inviteForm.reset();
  });

  const revoking = ref('');

  const onRevoke = async (inviteId: string) => {
    actionError.value = '';
    revoking.value = inviteId;

    try {
      await revokeInvite(inviteId);
      await refreshInvites();
    } catch (error) {
      actionError.value = (error as { message?: string }).message || 'Falha ao revogar.';
    } finally {
      revoking.value = '';
    }
  };

  const formatDate = (value: string) => new Date(value).toLocaleDateString('pt-BR');

  // --- Confirmações (remover / sair) -------------------------------------------------------------

  const confirmState = ref<{
    title: string;
    message: string;
    label: string;
    run: () => Promise<void>;
  } | null>(null);
  const confirmLoading = ref(false);

  const runConfirm = async () => {
    if (!confirmState.value) {
      return;
    }

    actionError.value = '';
    confirmLoading.value = true;

    try {
      await confirmState.value.run();
      confirmState.value = null;
    } catch (error) {
      actionError.value = (error as { message?: string }).message || 'Não foi possível concluir.';
    } finally {
      confirmLoading.value = false;
    }
  };

  const askRemove = (member: Member) => {
    confirmState.value = {
      title: 'Remover membro',
      message: `Remover ${member.name ?? member.email} da organização?`,
      label: 'Remover',
      run: async () => {
        await removeMember(member.userId);
        await refreshMembers();
      },
    };
  };

  const askLeave = () => {
    confirmState.value = {
      title: 'Sair da organização',
      message: `Você deixará de ter acesso a ${current.value?.name}. Deseja continuar?`,
      label: 'Sair',
      run: async () => {
        await leave();
        await load();
        await navigateTo('/');
      },
    };
  };
</script>

<template>
  <section class="mx-auto flex max-w-3xl flex-col gap-6">
    <header>
      <h1>Time</h1>
      <p class="mt-1 text-sm text-content-muted">
        Membros e convites de <span class="text-content">{{ current?.name ?? '—' }}</span
        >.
      </p>
    </header>

    <UiAlert v-if="actionError" variant="error">{{ actionError }}</UiAlert>

    <UiCard v-if="!current" title="Selecione uma organização">
      <p class="text-sm text-content-muted">
        Escolha ou crie uma organização no seletor da barra lateral.
      </p>
    </UiCard>

    <template v-else>
      <!-- Membros -->
      <UiCard title="Membros">
        <ul class="flex flex-col divide-y divide-surface-border">
          <li v-for="member in members" :key="member.userId" class="flex items-center gap-3 py-3">
            <span
              class="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-medium text-white"
            >
              {{ (member.name || member.email || '?').charAt(0).toUpperCase() }}
            </span>

            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium">
                {{ member.name ?? member.email }}
                <span v-if="isSelf(member)" class="text-xs text-content-muted">(você)</span>
              </p>
              <p class="truncate text-xs text-content-muted">{{ member.email }}</p>
            </div>

            <div class="w-32 shrink-0">
              <UiSelect
                v-if="canManage && !(isSelf(member) && !isOwner)"
                :model-value="member.role"
                :options="roleOptions"
                @update:model-value="role => changeRole(member, role)"
              />
              <UiBadge v-else variant="info" class="capitalize">{{ member.role }}</UiBadge>
            </div>

            <div class="w-9 shrink-0">
              <button
                v-if="isSelf(member)"
                type="button"
                title="Sair da organização"
                class="rounded-lg p-2 text-content-muted transition-colors hover:bg-surface hover:text-danger"
                @click="askLeave"
              >
                <Icon name="lucide:log-out" class="size-4" />
              </button>
              <button
                v-else-if="canManage"
                type="button"
                title="Remover membro"
                class="rounded-lg p-2 text-content-muted transition-colors hover:bg-surface hover:text-danger"
                @click="askRemove(member)"
              >
                <Icon name="lucide:user-minus" class="size-4" />
              </button>
            </div>
          </li>
        </ul>
      </UiCard>

      <!-- Convites (apenas admin/owner) -->
      <UiCard v-if="canManage" title="Convites" description="Convide pessoas por e-mail.">
        <form class="flex flex-col gap-3 sm:flex-row sm:items-start" @submit.prevent="onInvite">
          <div class="flex-1">
            <UiInput
              v-model="inviteForm.values.email"
              type="email"
              placeholder="colega@empresa.com"
              :error="inviteForm.errors.value.email"
            />
          </div>
          <div class="w-full sm:w-40">
            <UiSelect v-model="inviteForm.values.role" :options="inviteRoleOptions" />
          </div>
          <UiButton type="submit" :loading="inviteForm.submitting.value">Convidar</UiButton>
        </form>

        <UiAlert v-if="inviteForm.formError.value" variant="error" class="mt-3">
          {{ inviteForm.formError.value }}
        </UiAlert>

        <ul v-if="invites.length" class="mt-4 flex flex-col divide-y divide-surface-border">
          <li v-for="invite in invites" :key="invite.id" class="flex items-center gap-3 py-3">
            <Icon name="lucide:mail" class="size-4 shrink-0 text-content-muted" />
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm">{{ invite.email }}</p>
              <p class="text-xs text-content-muted">expira em {{ formatDate(invite.expiresAt) }}</p>
            </div>
            <UiBadge variant="neutral" class="capitalize">{{ invite.role }}</UiBadge>
            <button
              type="button"
              title="Revogar convite"
              :disabled="revoking === invite.id"
              class="rounded-lg p-2 text-content-muted transition-colors hover:bg-surface hover:text-danger disabled:opacity-60"
              @click="onRevoke(invite.id)"
            >
              <Icon
                :name="revoking === invite.id ? 'lucide:loader-circle' : 'lucide:x'"
                :class="['size-4', revoking === invite.id && 'animate-spin']"
              />
            </button>
          </li>
        </ul>

        <p v-else class="mt-4 text-sm text-content-muted">Nenhum convite pendente.</p>
      </UiCard>
    </template>

    <UiConfirm
      :open="Boolean(confirmState)"
      :title="confirmState?.title ?? ''"
      :message="confirmState?.message ?? ''"
      :confirm-label="confirmState?.label ?? 'Confirmar'"
      danger
      :loading="confirmLoading"
      @confirm="runConfirm"
      @update:open="value => !value && (confirmState = null)"
    />
  </section>
</template>
