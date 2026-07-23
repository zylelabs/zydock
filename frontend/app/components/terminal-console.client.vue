<script setup lang="ts">
  import { Terminal } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import '@xterm/xterm/css/xterm.css';

  // Client-only (`.client`): Xterm needs the DOM. Bridges the browser to the agent's interactive
  // console through the backend WebSocket — the one exception that reaches the browser directly
  // (the access token travels in the query string, like every other socket).
  const { serverId, containerId } = defineProps<{ serverId: string; containerId: string }>();

  const session = useSessionStore();
  const { public: runtime } = useRuntimeConfig();

  const host = useTemplateRef<HTMLElement>('host');
  const statusText = ref('connecting…');

  let terminal: Terminal | undefined;
  let socket: WebSocket | undefined;
  let fit: FitAddon | undefined;
  const onResize = () => fit?.fit();

  onMounted(() => {
    terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      theme: { background: '#0b0f14', foreground: '#e6edf3' },
    });

    fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host.value!);
    fit.fit();

    const origin = new URL(runtime.wsUrl).origin;
    const url = `${origin}/api/organizations/${session.organizationId}/servers/${serverId}/containers/${containerId}/console?shell=sh&token=${session.accessToken}`;

    socket = new WebSocket(url);

    socket.onopen = () => {
      statusText.value = 'connected';
    };

    socket.onmessage = event => {
      terminal?.write(typeof event.data === 'string' ? event.data : new Uint8Array(event.data));
    };

    socket.onclose = () => {
      statusText.value = 'disconnected';
      terminal?.write('\r\n\x1b[90m— connection closed —\x1b[0m\r\n');
    };

    terminal.onData(data => socket?.readyState === WebSocket.OPEN && socket.send(data));

    window.addEventListener('resize', onResize);
  });

  onBeforeUnmount(() => {
    window.removeEventListener('resize', onResize);
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
