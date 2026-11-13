import { normalizeEmail } from '../../common/normalized-email';
import { PrismaService } from '../../prisma/prisma.service';
import { STAFF_ROLES, StaffRole } from './dto/staff.dto';
import { accountNotFound, StaffService } from './staff.service';

/** In the operator's words: the ops command they type maps onto these verbs. */
const USAGE = 'Usage: staff-grant --email EMAIL --role ADMIN|SUPPORT | staff-revoke --email EMAIL | staff-list';

interface Verb {
  /** The arguments after the verb, checked before anything runs. */
  accepts: (rest: string[]) => boolean;
  run: (rest: string[], staff: StaffService, prisma: PrismaService) => Promise<string>;
}

const VERBS: Record<string, Verb> = {
  list: {
    accepts: (rest) => rest.length === 0,
    run: async (_rest, staff) => (await staff.list()).items.map((member) => `${member.role}\t${member.email}\t${member.name}`).join('\n'),
  },
  grant: {
    accepts: ([email, role, ...extra]) => Boolean(email?.trim()) && (STAFF_ROLES as readonly string[]).includes(role ?? '') && !extra.length,
    run: async ([email, role], staff) => {
      const member = await staff.grant(normalizeEmail(email), role as StaffRole, null);
      return `${member.email} is now ${member.role}`;
    },
  },
  revoke: {
    accepts: ([email, ...extra]) => Boolean(email?.trim()) && !extra.length,
    run: async ([email], staff, prisma) => {
      const user = await prisma.user.findFirst({ where: { email: normalizeEmail(email) }, select: { id: true } });
      if (!user) throw accountNotFound('email');
      await staff.revoke(user.id, null);
      return `${normalizeEmail(email)} is no longer staff`;
    },
  },
};

/**
 * The tool behind `node scripts/ops.mjs staff-*`. It makes the first admin, so
 * it acts with no admin behind it (`null`); every later change can go through
 * the API instead. Returns what it did, for the operator's terminal.
 */
export async function runStaffCommand(args: string[], staff: StaffService, prisma: PrismaService): Promise<string> {
  const [name, ...rest] = args;
  const verb = Object.hasOwn(VERBS, name ?? '') ? VERBS[name] : undefined;
  if (!verb?.accepts(rest)) throw new Error(USAGE);
  return verb.run(rest, staff, prisma);
}
