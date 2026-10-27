import { ConfigService } from '@nestjs/config';
import { PrismaService } from './prisma/prisma.service';
import { EnquiryJournal } from './modules/sales/enquiry-journal';
import { EnquiryPrivacyService } from './modules/sales/enquiry-privacy.service';
import { EnquiryRetentionService } from './modules/sales/enquiry-retention.service';

async function initializeFreshJournal(prisma: PrismaService, journal: EnquiryJournal): Promise<void> {
  if (process.env.SALES_PRIVACY_NEW_INSTALL !== 'true' || await prisma.enquiryContact.count() || await prisma.enquiryPrivacyRedaction.count()) throw new Error('Zero journal initialization requires an explicit fresh installation with no intake history');
  await journal.initialize();
  process.stdout.write('Signed zero journal initialized for explicit fresh installation.\n');
}

async function assertLatestJournal(journal: EnquiryJournal): Promise<void> {
  if (process.env.SALES_PRIVACY_JOURNAL_LATEST_VERIFIED !== 'true') throw new Error('Independently confirm this protected journal is the latest preserved high-water evidence');
  const expected = process.env.SALES_PRIVACY_RESTORE_SEQUENCE ?? '';
  if (!/^\d+$/.test(expected) || !Number.isSafeInteger(Number(expected))) throw new Error('SALES_PRIVACY_RESTORE_SEQUENCE must state the independently verified latest sequence');
  const manifest = await journal.manifest();
  if (manifest.sequence !== Number(expected)) throw new Error('Protected journal does not match the independently verified latest high-water mark');
}

async function replayAndVerify(prisma: PrismaService, config: ConfigService, journal: EnquiryJournal): Promise<void> {
  await assertLatestJournal(journal);
  const privacy = new EnquiryPrivacyService(prisma, config);
  const replayed = await privacy.replayJournal();
  const retention = await new EnquiryRetentionService(prisma, config).sweep();
  while (await privacy.checkpoint()) { /* Each filesystem batch is independently durable and at most 100 receipts. */ }
  await privacy.finalizeCheckpointedRequests();
  const outstanding = await prisma.enquiryPrivacyRedaction.count({ where: { checkpointedAt: null } });
  if (outstanding || retention.overdue) throw new Error('Privacy recovery is incomplete; remain offline');
  process.stdout.write(JSON.stringify({ replayed, uncheckpointed: outstanding, overdue: retention.overdue, latestSequence: (await journal.manifest()).sequence }) + '\n');
}

/** Run while API and outbound workers are stopped; never starts Nest or SMTP. */
async function recoverIntakePrivacy(): Promise<void> {
  if (process.env.RESTORE_QUIESCED !== 'true') throw new Error('Stop API and all outbound workers before intake journal recovery');
  const prisma = new PrismaService();
  const config = new ConfigService(process.env);
  const journal = new EnquiryJournal(process.env.SALES_PRIVACY_JOURNAL_DIR ?? '', process.env.SALES_PRIVACY_JOURNAL_KEY ?? '');
  try {
    if (process.argv[2] === 'initialize') await initializeFreshJournal(prisma, journal);
    else await replayAndVerify(prisma, config, journal);
  } finally { await prisma.$disconnect(); }
}

void recoverIntakePrivacy().catch(() => { process.stderr.write('Intake privacy recovery failed; API and outbound workers must remain offline.\n'); process.exitCode = 1; });
