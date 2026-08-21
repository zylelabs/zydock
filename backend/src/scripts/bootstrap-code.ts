import { connectDatabase, disconnectDatabase } from '../config/mongodb';
import { regenerateBootstrapCode } from '../modules/bootstrap/bootstrap.service';
import { logError, logInfo, logWarn } from '../utils/logger';

const run = async () => {
  await connectDatabase();

  try {
    const code = await regenerateBootstrapCode();

    if (!code) {
      logWarn('A superuser already exists, refusing to generate a bootstrap code');
      return;
    }

    logInfo(`Bootstrap code: ${code}`);
  } finally {
    await disconnectDatabase();
  }
};

run()
  .then(() => process.exit(0))
  .catch(error => {
    logError('Bootstrap code generation failed', error);
    process.exit(1);
  });
