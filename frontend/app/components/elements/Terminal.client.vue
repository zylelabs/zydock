<script setup lang="ts">
  import { Terminal as XTerm } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import '@xterm/xterm/css/xterm.css';

  import { mergeClasses } from '~/utils';
  import { resolveWebSocketUrl } from '~/utils/websocket';

  const props = defineProps<{
    serverId: string;
    containerId: string;
    shell?: string;
    mode?: 'shell' | 'attach';
    applicationId?: string;
    replay?: boolean;
    hostClass?: string;
  }>();

  const session = useSessionStore();
  const { public: runtime } = useRuntimeConfig();

  const host = ref<HTMLElement | null>(null);
  const statusText = ref('connecting…');

  let terminal: XTerm | undefined;
  let socket: WebSocket | undefined;
  let fit: FitAddon | undefined;

  const resolveToken = (name: string, fallback: string) =>
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

  const sendResize = () => {
    if (!terminal || socket?.readyState !== WebSocket.OPEN) {
      return;
    }

    const control = { type: 'resize', columns: terminal.cols, rows: terminal.rows };

    socket.send(new TextEncoder().encode(JSON.stringify(control)));
  };

  const handleResize = () => {
    fit?.fit();
    sendResize();
  };

  const consoleUrl = () => {
    const origin = new URL(resolveWebSocketUrl(runtime.wsUrl)).origin;
    const path = `/api/organizations/${session.organizationId}/servers/${props.serverId}/containers/${props.containerId}/console`;
    const query = new URLSearchParams({
      shell: props.shell ?? 'sh',
      mode: props.mode ?? 'shell',
      token: session.accessToken ?? '',
    });

    if (props.applicationId) {
      query.set('applicationId', props.applicationId);
    }

    if (props.replay) {
      query.set('replay', '1');
    }

    return `${origin}${path}?${query.toString()}`;
  };

  onMounted(() => {
    if (!host.value) {
      return;
    }

    terminal = new XTerm({
      convertEol: true,
      cursorBlink: true,
      fontSize: 12.5,
      fontFamily: "'JetBrains Mono', ui-monospace, monospace",
      theme: {
        background: resolveToken('--color-terminal', '#151515'),
        foreground: 'rgba(255, 255, 255, 0.85)',
        cursor: resolveToken('--color-accent', '#645df1'),
      },
    });

    fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host.value);
    fit.fit();
    terminal.focus();

    socket = new WebSocket(consoleUrl());

    socket.onopen = () => {
      statusText.value = 'connected';
      terminal?.focus();
      sendResize();
    };

    socket.onmessage = event => {
      terminal?.write(typeof event.data === 'string' ? event.data : new Uint8Array(event.data));
    };

    socket.onclose = () => {
      statusText.value = 'disconnected';
      terminal?.write('\r\n\x1b[90m— connection closed —\x1b[0m\r\n');
    };

    terminal.onData(data => socket?.readyState === WebSocket.OPEN && socket.send(data));

    window.addEventListener('resize', handleResize);
  });

  onBeforeUnmount(() => {
    window.removeEventListener('resize', handleResize);
    socket?.close();
    terminal?.dispose();
  });
</script>

<template>
  <div class="flex flex-col gap-2">
    <span class="text-caption text-ink-2">{{ statusText }}</span>
    <div
      ref="host"
      :class="mergeClasses('h-[70vh] overflow-hidden rounded-card bg-terminal p-4', hostClass)"
    />
  </div>
</template>
