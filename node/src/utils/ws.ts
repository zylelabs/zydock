import { createBunWebSocket } from 'hono/bun';

/**
 * Single Bun WebSocket helper for the whole agent. `createBunWebSocket` must be called once and its
 * `websocket` handler exported to the server entrypoint — the interactive console is the only thing
 * that upgrades a connection on the agent.
 */
export const { upgradeWebSocket, websocket } = createBunWebSocket();
