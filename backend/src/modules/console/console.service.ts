export type ConsoleSessionHandle = {
  close: () => void;
};

const handlesBySessionId = new Map<string, Set<ConsoleSessionHandle>>();

export const registerConsoleSession = (sessionId: string, handle: ConsoleSessionHandle) => {
  const handles = handlesBySessionId.get(sessionId) ?? new Set();

  handles.add(handle);
  handlesBySessionId.set(sessionId, handles);
};

export const unregisterConsoleSession = (sessionId: string, handle: ConsoleSessionHandle) => {
  const handles = handlesBySessionId.get(sessionId);

  if (!handles) {
    return;
  }

  handles.delete(handle);

  if (handles.size === 0) {
    handlesBySessionId.delete(sessionId);
  }
};

export const closeConsoleSessionsOf = (sessionId: string) => {
  const handles = handlesBySessionId.get(sessionId);

  if (!handles) {
    return;
  }

  for (const handle of handles) {
    handle.close();
  }

  handlesBySessionId.delete(sessionId);
};
