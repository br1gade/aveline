import { runStaffCommand } from './modules/staff/staff-command';
import { StaffService } from './modules/staff/staff.service';
import { PrismaService } from './prisma/prisma.service';

/**
 * `node dist/staff-roles.js grant <email> ADMIN|SUPPORT | revoke <email> | list`,
 * run by `node scripts/ops.mjs staff-*` in a throwaway API container (docs/DEPLOYMENT.md).
 * Never starts Nest: it needs only the database.
 */
async function changeStaffRoles(): Promise<void> {
  const prisma = new PrismaService();
  try {
    process.stdout.write(`${await runStaffCommand(process.argv.slice(2), new StaffService(prisma), prisma)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

void changeStaffRoles().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Staff role change failed'}\n`);
  process.exitCode = 1;
});
