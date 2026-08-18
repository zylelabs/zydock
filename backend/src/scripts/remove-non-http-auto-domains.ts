import { connectDatabase, disconnectDatabase } from '../config/mongodb';
import { logError, logInfo } from '../utils/logger';
import applicationModel from '../modules/applications/application.model';
import domainModel from '../modules/domains/domain.model';
import { removeDomain } from '../modules/domains/domain.service';

const APPLY_FLAG = '--apply';

const run = async () => {
  const apply = process.argv.includes(APPLY_FLAG);

  await connectDatabase();

  try {
    const applications = await applicationModel
      .find({ source: 'compose', 'compose.expose.kind': { $ne: 'http' } })
      .select('_id name slug compose.expose.kind');

    if (!applications.length) {
      logInfo('No non-HTTP compose application found');
      return;
    }

    const domains = await domainModel.find({
      auto: true,
      applicationId: { $in: applications.map(application => application._id) },
    });

    if (!domains.length) {
      logInfo('No automatic domain to remove', { applications: applications.length });
      return;
    }

    const applicationById = new Map(
      applications.map(application => [String(application._id), application]),
    );

    for (const domain of domains) {
      const application = applicationById.get(String(domain.applicationId));

      logInfo(apply ? 'Removing automatic domain' : 'Would remove automatic domain', {
        hostname: domain.hostname,
        application: application?.slug ?? String(domain.applicationId),
        kind: application?.compose?.expose.kind,
      });
    }

    if (!apply) {
      logInfo(`Dry run: re-run with ${APPLY_FLAG} to remove them`, { domains: domains.length });
      return;
    }

    for (const domain of domains) {
      await removeDomain(domain);
    }

    logInfo('Automatic domains removed', { domains: domains.length });
  } finally {
    await disconnectDatabase();
  }
};

run()
  .then(() => process.exit(0))
  .catch(error => {
    logError('Failed to remove automatic domains of non-HTTP applications', error);
    process.exit(1);
  });
