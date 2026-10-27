import { PrismaClient } from '@prisma/client';
import { readFile } from 'node:fs/promises';

// This explicit operator command is deliberately absent from automatic migrations.
const action = process.argv[2];
if (!['inspect', 'drop-single-membership-index', 'enable-writes', 'disable-writes'].includes(action)) throw new Error('Choose inspect, drop-single-membership-index, enable-writes or disable-writes');
const prisma = new PrismaClient();
try {
  if (action === 'inspect') {
    const gate = await prisma.runtimeCompatibility.findUnique({ where: { id: 'organization-context' } });
    const duplicates = await prisma.$queryRaw`SELECT count(*)::int AS count FROM (SELECT "userId" FROM organization_memberships GROUP BY "userId" HAVING count(*) > 1) members`;
    const index = await prisma.$queryRaw`SELECT indexname FROM pg_indexes WHERE indexname = 'organization_memberships_userId_key'`;
    process.stdout.write(JSON.stringify({ gate, multipleMembershipUsers: duplicates[0].count, hasSingleMembershipIndex: index.length > 0 }) + '\n');
  } else {
    const evidence = JSON.parse(await readFile(process.env.ORGANIZATION_CUTOVER_EVIDENCE_FILE ?? '', 'utf8'));
    const required = ['readerWriterInventory', 'raceTests', 'populatedMigration', 'restoreRehearsal', 'fourLanguageTabAcceptance', 'oldRuntimeExclusion'];
    if (evidence.revision !== 2 || required.some((key) => evidence[key] !== true)) throw new Error('Complete revision-2 activation evidence is required');
    if (action === 'drop-single-membership-index' && process.env.ORGANIZATION_CUTOVER_MAINTENANCE !== 'confirmed') throw new Error('Maintenance with old credentials/sessions excluded must be confirmed');
    await prisma.$transaction(async (tx) => {
      const [gate] = await tx.$queryRaw`SELECT * FROM runtime_compatibility WHERE id = 'organization-context' FOR UPDATE`;
      if (!gate || gate.minimumRevision !== 2) throw new Error('Unsupported runtime revision');
      if (action === 'drop-single-membership-index') {
        if (gate.multiOrganizationWrites) throw new Error('Disable additional writes before cutover');
        await tx.$executeRaw`DROP INDEX IF EXISTS "organization_memberships_userId_key"`;
      } else {
        const index = await tx.$queryRaw`SELECT indexname FROM pg_indexes WHERE indexname = 'organization_memberships_userId_key'`;
        if (action === 'enable-writes' && index.length) throw new Error('Index cutover is incomplete');
        await tx.runtimeCompatibility.update({ where: { id: 'organization-context' }, data: { multiOrganizationWrites: action === 'enable-writes' } });
      }
    }, { timeout: 10_000 });
    process.stdout.write('Organization compatibility state updated.\n');
  }
} finally { await prisma.$disconnect(); }
