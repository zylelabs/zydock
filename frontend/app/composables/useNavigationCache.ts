const fetchedAt = new Map<string, number>();

const DEFAULT_TTL_MS = 45000;

export const useNavigationCache = (ttlMs = DEFAULT_TTL_MS) => {
  const nuxtApp = useNuxtApp();

  const getCachedData = <T>(key: string): T | undefined => {
    const at = fetchedAt.get(key);

    if (at === undefined || Date.now() - at > ttlMs) {
      return undefined;
    }

    return (
      (nuxtApp.payload.data[key] as T | undefined) ?? (nuxtApp.static.data[key] as T | undefined)
    );
  };

  const markFetched = (key: string) => {
    fetchedAt.set(key, Date.now());
  };

  return { getCachedData, markFetched };
};
