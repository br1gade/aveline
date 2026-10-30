// Runs in the candidate image before migrations; never initializes a journal.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');
const { CURRENT_READER_REVISION } = require('../dist/prisma/reader-compatibility.js');
const { validateEnv } = require('../dist/common/env.validation.js');
const { EnquiryJournal } = require('../dist/modules/sales/enquiry-journal.js');
const { access } = await import('node:fs/promises');
const prisma = new PrismaClient();
try {
  validateEnv(process.env);
  if (!process.env.S3_ACCESS_KEY_ID || !process.env.S3_SECRET_ACCESS_KEY || !process.env.PRIVATE_S3_BUCKET || process.env.S3_BUCKET === process.env.PRIVATE_S3_BUCKET) throw new Error('storage');
  await access(process.env.SALES_PRIVACY_JOURNAL_DIR, 2);
  const [{ populated }] = await prisma.$queryRaw`SELECT EXISTS(SELECT 1 FROM pg_tables WHERE schemaname='public') AS populated`;
  const [{ compatibility, intake, receipts }] = await prisma.$queryRaw`SELECT to_regclass('public.runtime_compatibility')::text AS compatibility,to_regclass('public.sales_enquiries')::text AS intake,to_regclass('public.enquiry_privacy_redactions')::text AS receipts`;
  if (compatibility) {
    const [gate] = await prisma.$queryRaw`SELECT "minimumRevision" FROM runtime_compatibility WHERE id='organization-context'`;
    if (!gate || gate.minimumRevision > CURRENT_READER_REVISION) throw new Error('reader');
  }
  let hasIntakeHistory = false;
  if (intake) [{ present: hasIntakeHistory }] = await prisma.$queryRaw`SELECT EXISTS(SELECT 1 FROM sales_enquiries) AS present`;
  let acknowledged = 0;
  if (receipts) { const [row] = await prisma.$queryRaw`SELECT COALESCE(MAX("checkpointSequence"),0)::text AS sequence FROM enquiry_privacy_redactions`; acknowledged = Number(row.sequence); }
  const journal = new EnquiryJournal(process.env.SALES_PRIVACY_JOURNAL_DIR, process.env.SALES_PRIVACY_JOURNAL_KEY);
  let hasManifest = true;
  try { await access(`${process.env.SALES_PRIVACY_JOURNAL_DIR}/manifest.json`); } catch { hasManifest = false; }
  if (hasManifest || hasIntakeHistory || acknowledged > 0 || process.env.SALES_INTAKE_ENABLED === 'true') {
    await journal.append([], acknowledged);
    if ((await journal.manifest()).sequence !== acknowledged) throw new Error('offline journal replay required');
  }
  console.log(populated ? 'POPULATED' : 'EMPTY');
} catch {
  console.error('Candidate preflight refused: review configuration, reader floor, journal identity/preservation and volume permissions.');
  process.exitCode = 1;
} finally { await prisma.$disconnect(); }
