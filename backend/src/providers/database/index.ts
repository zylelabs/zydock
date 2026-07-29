import {
  DATABASE_ENGINES,
  type DatabaseEngine,
  type DatabaseProvider,
  type DatabaseProviderDependencies,
  type DatabaseProviderFactory,
} from './database.contract';
import { createContainerDatabaseProvider } from './container.provider';
import { ENGINES } from './engines';

const factories: Partial<Record<DatabaseEngine, DatabaseProviderFactory>> = Object.fromEntries(
  DATABASE_ENGINES.map(engine => [
    engine,
    (dependencies: DatabaseProviderDependencies) =>
      createContainerDatabaseProvider(ENGINES[engine], dependencies),
  ]),
);

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
