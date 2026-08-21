import { connectDatabase, disconnectDatabase } from '../config/mongodb';
import userModel from '../modules/users/user.model';
import { logError, logInfo } from '../utils/logger';

const run = async () => {
  await connectDatabase();

  try {
    const result = await userModel.collection.updateMany(
      { provisionedBySeed: true, superuser: { $ne: true } },
      { $set: { superuser: true } },
    );

    logInfo('Superuser marker migration complete', { updated: result.modifiedCount });
  } finally {
    await disconnectDatabase();
  }
};

run()
  .then(() => process.exit(0))
  .catch(error => {
    logError('Superuser marker migration failed', error);
    process.exit(1);
  });
