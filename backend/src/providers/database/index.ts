import {
  type DatabaseEngine,
  type DatabaseProvider,
  type DatabaseProviderDependencies,
  type DatabaseProviderFactory,
} from './database.contract';

const factories: Partial<Record<DatabaseEngine, DatabaseProviderFactory>> = {};

export const resolveDatabaseProvider = (
  engine: DatabaseEngine,
  dependencies: DatabaseProviderDependencies,
): DatabaseProvider => {
  const factory = factories[engine];

  if (!factory) {
    throw new Error(`Database engine "${engine}" has no registered implementation`);
  }

  return factory(dependencies);
};

export type * from './database.contract';
