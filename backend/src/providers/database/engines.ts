import type { DatabaseEngine } from './database.contract';
import type { EngineConfig } from './container.provider';

const shell = (script: string, ...args: string[]) => ['sh', '-c', script, 'sh', ...args];

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
      MYSQL_ROOT_PASSWORD: password,
      MYSQL_USER: username,
      MYSQL_PASSWORD: password,
      MYSQL_DATABASE: database,
    }),
    connectionUri: ({ username, password, host, port, database }) =>
      `mysql://${username}:${password}@${host}:${port}/${database}`,
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
    command: ({ password }) => ['redis-server', '--requirepass', password],
    environment: () => ({}),
    connectionUri: ({ password, host, port }) => `redis://default:${password}@${host}:${port}`,
    dump: ({ password }) =>
      shell('redis-cli --no-auth-warning -a "$1" save >/dev/null && cat /data/dump.rdb', password),
    restore: ({ password }) =>
      shell(
        'redis-cli --no-auth-warning -a "$1" config set save "" >/dev/null && cat > /data/dump.rdb',
        password,
      ),
    restartAfterRestore: true,
    extension: 'rdb',
  },
};
