import type { DatabaseEngine } from './database.contract';
import type { EngineConfig } from './container.provider';

/**
 * Dump and restore commands run through `sh -c` with the credentials as **positional arguments**:
 * they never end up inside the script text, so a password with a quote in it cannot break — or
 * escape — the command.
 */
const shell = (script: string, ...args: string[]) => ['sh', '-c', script, 'sh', ...args];

/** Per-engine knowledge: image, port, data path, credential mapping, URI and dump/restore. */
export const ENGINES: Record<DatabaseEngine, EngineConfig> = {
  postgresql: {
    image: version => `postgres:${version}`,
    port: 5432,
    dataPath: '/var/lib/postgresql/data',
    username: 'zydock',
    environment: ({ username, password, database }) => ({
      POSTGRES_USER: username,
      POSTGRES_PASSWORD: password,
      POSTGRES_DB: database,
    }),
    connectionUri: ({ username, password, host, port, database }) =>
      `postgresql://${username}:${password}@${host}:${port}/${database}`,
    // The custom format is compressed and is what `pg_restore` reads; `--clean` replaces what is
    // there, so restoring twice lands on the same state.
    dump: ({ username, password, database }) =>
      shell('PGPASSWORD="$1" pg_dump -U "$2" -d "$3" -Fc', password, username, database ?? ''),
    restore: ({ username, password, database }) =>
      shell(
        'PGPASSWORD="$1" pg_restore -U "$2" -d "$3" --clean --if-exists --no-owner',
        password,
        username,
        database ?? '',
      ),
    extension: 'dump',
  },
  mysql: {
    image: version => `mysql:${version}`,
    port: 3306,
    dataPath: '/var/lib/mysql',
    username: 'zydock',
    environment: ({ username, password, database }) => ({
      // The root password is required by the image; the application connects as the created user.
      MYSQL_ROOT_PASSWORD: password,
      MYSQL_USER: username,
      MYSQL_PASSWORD: password,
      MYSQL_DATABASE: database,
    }),
    connectionUri: ({ username, password, host, port, database }) =>
      `mysql://${username}:${password}@${host}:${port}/${database}`,
    // As root, because the created user cannot lock or recreate the schema. `--databases` puts the
    // `CREATE DATABASE`/`USE` in the dump, so the restore does not need to name it again.
    dump: ({ password, database }) =>
      shell(
        'mysqldump -uroot -p"$1" --single-transaction --routines --databases "$2"',
        password,
        database ?? '',
      ),
    restore: ({ password }) => shell('mysql -uroot -p"$1"', password),
    extension: 'sql',
  },
  mongodb: {
    image: version => `mongo:${version}`,
    port: 27017,
    dataPath: '/data/db',
    username: 'zydock',
    environment: ({ username, password, database }) => ({
      MONGO_INITDB_ROOT_USERNAME: username,
      MONGO_INITDB_ROOT_PASSWORD: password,
      MONGO_INITDB_DATABASE: database,
    }),
    connectionUri: ({ username, password, host, port, database }) =>
      `mongodb://${username}:${password}@${host}:${port}/${database}?authSource=admin`,
    // `--archive` without a path writes the whole dump to standard output as one stream.
    dump: ({ username, password }) =>
      shell(
        'mongodump --archive --quiet -u "$1" -p "$2" --authenticationDatabase admin',
        username,
        password,
      ),
    restore: ({ username, password }) =>
      shell(
        'mongorestore --archive --drop --quiet -u "$1" -p "$2" --authenticationDatabase admin',
        username,
        password,
      ),
    extension: 'archive',
  },
  redis: {
    image: version => `redis:${version}`,
    port: 6379,
    dataPath: '/data',
    username: 'default',
    // The password is a command flag, not an env var. The URI names the `default` user on purpose:
    // an empty username (`redis://:pass@`) makes redis-cli and many clients send an empty username
    // in AUTH, which Redis rejects with WRONGPASS.
    command: ({ password }) => ['redis-server', '--requirepass', password],
    environment: () => ({}),
    connectionUri: ({ password, host, port }) => `redis://default:${password}@${host}:${port}`,
    // Redis has no dump command: `SAVE` writes the snapshot, and the snapshot is the backup.
    dump: ({ password }) =>
      shell('redis-cli --no-auth-warning -a "$1" save >/dev/null && cat /data/dump.rdb', password),
    // Saving is turned off before the file is replaced — otherwise the shutdown of the restart
    // below would write the *current* dataset over the snapshot that was just restored.
    restore: ({ password }) =>
      shell(
        'redis-cli --no-auth-warning -a "$1" config set save "" >/dev/null && cat > /data/dump.rdb',
        password,
      ),
    restartAfterRestore: true,
    extension: 'rdb',
  },
};
