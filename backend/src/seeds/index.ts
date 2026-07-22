import { connectDatabase, disconnectDatabase } from '../config/mongodb';
import { logError } from '../utils/logger';
import { seedSuperadmins } from './superadmin.seed';

const run = async () => {
  await connectDatabase();

  try {
    await seedSuperadmins();
  } finally {
    await disconnectDatabase();
  }
};

run()
  .then(() => process.exit(0))
  .catch(error => {
    logError('Seed failed', error);
    process.exit(1);
  });
