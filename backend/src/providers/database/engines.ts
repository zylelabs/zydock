import type { DatabaseEngine } from './database.contract';
import type { EngineConfig } from './container.provider';

const shell = (script: string, ...args: string[]) => ['sh', '-c', script, 'sh', ...args];

const diskScript = (dataPath: string) =>
  [
    `set -- $(df -B1 --output=size,used "${dataPath}" 2>/dev/null | tail -n1)`,
    'echo "diskTotalBytes=$1"',
    'echo "diskUsedBytes=$2"',
    `set -- $(du -sb "${dataPath}" 2>/dev/null)`,
    'echo "dataPathSizeBytes=$1"',
  ].join('; ');

const POSTGRESQL_DATA_PATH = '/var/lib/postgresql/data';
const MYSQL_DATA_PATH = '/var/lib/mysql';
const MONGODB_DATA_PATH = '/data/db';
const REDIS_DATA_PATH = '/data';

export const ENGINES: Record<DatabaseEngine, EngineConfig> = {
  postgresql: {
    image: version => `postgres:${version}`,
    port: 5432,
    dataPath: POSTGRESQL_DATA_PATH,
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
    stats: ({ username, password, database }) =>
      shell(
        'PGPASSWORD="$1" psql -U "$2" -d "$3" -tAc "' +
          "SELECT 'connections=' || count(*) FROM pg_stat_activity " +
          "UNION ALL SELECT 'maxConnections=' || setting FROM pg_settings WHERE name = 'max_connections' " +
          "UNION ALL SELECT 'sizeBytes=' || pg_database_size(current_database()) " +
          "UNION ALL SELECT 'versionLabel=' || current_setting('server_version')" +
          `"; ${diskScript(POSTGRESQL_DATA_PATH)}`,
        password,
        username,
        database ?? '',
      ),
    extension: 'dump',
  },
  mysql: {
    image: version => `mysql:${version}`,
    port: 3306,
    dataPath: MYSQL_DATA_PATH,
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
    stats: ({ password, database }) =>
      shell(
        'mysql -uroot -p"$1" -N -e "' +
          "SELECT CONCAT('connections=', (SELECT VARIABLE_VALUE FROM performance_schema.global_status WHERE VARIABLE_NAME = 'Threads_connected')) " +
          "UNION ALL SELECT CONCAT('maxConnections=', @@max_connections) " +
          "UNION ALL SELECT CONCAT('sizeBytes=', (SELECT COALESCE(SUM(data_length + index_length), 0) FROM information_schema.tables WHERE table_schema = '$2')) " +
          "UNION ALL SELECT CONCAT('versionLabel=', VERSION())" +
          `"; ${diskScript(MYSQL_DATA_PATH)}`,
        password,
        database ?? '',
      ),
    extension: 'sql',
  },
  mongodb: {
    image: version => `mongo:${version}`,
    port: 27017,
    dataPath: MONGODB_DATA_PATH,
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
    stats: ({ username, password, database }) =>
      shell(
        'mongosh --quiet -u "$1" -p "$2" --authenticationDatabase admin --eval "' +
          'const status = db.serverStatus(); ' +
          "const stats = db.getSiblingDB('$3').stats(); " +
          "print('connections=' + status.connections.current); " +
          "print('maxConnections=' + (status.connections.current + status.connections.available)); " +
          "print('sizeBytes=' + stats.dataSize); " +
          "print('versionLabel=' + db.version())" +
          `"; ${diskScript(MONGODB_DATA_PATH)}`,
        username,
        password,
        database ?? '',
      ),
    extension: 'archive',
  },
  redis: {
    image: version => `redis:${version}`,
    port: 6379,
    dataPath: REDIS_DATA_PATH,
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
    stats: ({ password }) =>
      shell(
        [
          'CONN=$(redis-cli --no-auth-warning -a "$1" INFO clients | grep "^connected_clients:" | tr -d "\\r" | cut -d: -f2)',
          'MAXC=$(redis-cli --no-auth-warning -a "$1" CONFIG GET maxclients | tail -n1 | tr -d "\\r")',
          'MEM=$(redis-cli --no-auth-warning -a "$1" INFO memory | grep "^used_memory:" | tr -d "\\r" | cut -d: -f2)',
          'VER=$(redis-cli --no-auth-warning -a "$1" INFO server | grep "^redis_version:" | tr -d "\\r" | cut -d: -f2)',
          'echo "connections=$CONN"',
          'echo "maxConnections=$MAXC"',
          'echo "sizeBytes=$MEM"',
          'echo "versionLabel=$VER"',
          diskScript(REDIS_DATA_PATH),
        ].join('; '),
        password,
      ),
    restartAfterRestore: true,
    extension: 'rdb',
  },
};
