<script setup lang="ts">
  import { Terminal as XTerm } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import '@xterm/xterm/css/xterm.css';

  const props = defineProps<{ serverId: string; containerId: string; shell?: string }>();

  const session = useSessionStore();
  const { public: runtime } = useRuntimeConfig();

  const host = ref<HTMLElement | null>(null);
  const statusText = ref('connecting…');

  let terminal: XTerm | undefined;
  let socket: WebSocket | undefined;
  let fit: FitAddon | undefined;

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
    const origin = new URL(runtime.wsUrl).origin;
    const path = `/api/organizations/${session.organizationId}/servers/${props.serverId}/containers/${props.containerId}/console`;
    const query = new URLSearchParams({
      shell: props.shell ?? 'sh',
      token: session.accessToken ?? '',
    });

    return `${origin}${path}?${query.toString()}`;
  };

  onMounted(() => {
    if (!host.value) {
      return;
    }

    terminal = new XTerm({
      convertEol: true,
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      theme: { background: '#05060f', foreground: '#cdcfdb', cursor: '#645df1' },
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
    <span class="text-xs text-content-muted">{{ statusText }}</span>
    <div
      ref="host"
      class="h-[70vh] overflow-hidden rounded-xl border border-surface-border bg-surface p-2"
    />
  </div>
</template>
