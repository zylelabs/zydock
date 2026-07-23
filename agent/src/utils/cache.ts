type Entry<T> = {
  value: T;
  expiresAt: number;
};

export type TtlCache<T> = {
  get: () => T | undefined;
  set: (value: T) => T;
  resolve: (produce: () => Promise<T>) => Promise<T>;
  clear: () => void;
};

export const createTtlCache = <T>(ttlSeconds: number): TtlCache<T> => {
  let entry: Entry<T> | undefined;
  let pending: Promise<T> | undefined;

  const get = () => {
    if (!entry || entry.expiresAt <= Date.now()) {
      return undefined;
    }

    return entry.value;
  };

  const set = (value: T) => {
    entry = { value, expiresAt: Date.now() + ttlSeconds * 1000 };

    return value;
  };

  return {
    get,
    set,
    clear: () => {
      entry = undefined;
    },
    resolve: async produce => {
      const cached = get();

      if (cached !== undefined) {
        return cached;
      }

      pending ??= produce()
        .then(set)
        .finally(() => {
          pending = undefined;
        });

      return pending;
    },
  };
};
