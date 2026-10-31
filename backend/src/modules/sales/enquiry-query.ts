import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { lockStaff } from './enquiry-access';
import { assertIntakeEnabled } from './enquiry-config';
import { lockIntake } from './enquiry-lock';
import { ENQUIRY_SELECT } from './enquiry-projection';
import { EnquiryPageDto, EnquiryQueueDto } from './dto/enquiry.dto';

interface PageCursor { createdAt: string; id: string; filtersDigest: string }
function digest(filters: object): string { return createHash('sha256').update(JSON.stringify(filters)).digest('hex'); }
function decodeCursor(value: string | undefined, filters: object): PageCursor | null {
  if (!value) return null;
  try {
    const cursor = JSON.parse(Buffer.from(value, 'base64url').toString()) as PageCursor;
    if (cursor.filtersDigest !== digest(filters) || typeof cursor.id !== 'string' || cursor.id.length > 128 || !Number.isFinite(Date.parse(cursor.createdAt))) throw new Error();
    return cursor;
  } catch { throw new BadRequestException('cursor: invalid for these filters'); }
}
function page<T extends { id: string; createdAt: Date }>(rows: T[], limit: number, filters: object) {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  const nextCursor = rows.length > limit && last ? Buffer.from(JSON.stringify({ id: last.id, createdAt: last.createdAt.toISOString(), filtersDigest: digest(filters) })).toString('base64url') : null;
  return { items, nextCursor };
}
function cursorWhere(cursor: PageCursor | null) {
  return cursor ? { OR: [{ createdAt: { lt: new Date(cursor.createdAt) } }, { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } }] } : {};
}

export async function listEnquiries(tx: Prisma.TransactionClient, input: { userId: string; query: EnquiryQueueDto }, config: ConfigService) {
  assertIntakeEnabled(config);
  await lockIntake(tx);
  const candidate = await tx.user.findUnique({ where: { id: input.userId }, select: { platformRole: true } });
  const filters = { userId: input.userId, stage: input.query.stage, search: input.query.search?.trim().toLowerCase() };
  const cursor = decodeCursor(input.query.cursor, filters);
  const limit = input.query.limit ?? 50;
  const { scope, searchFilter, after, stage } = queuePredicates(input, candidate?.platformRole, cursor);
  const ids = await tx.$queryRaw<{ id: string }[]>`SELECT s.id FROM sales_enquiries s JOIN enquiry_contacts c ON c."enquiryId"=s.id WHERE ${scope} AND ${stage} AND ${searchFilter} AND ${after} ORDER BY s."createdAt" DESC,s.id DESC LIMIT ${limit + 1} FOR SHARE OF s`;
  const actor = await lockStaff(tx, input.userId);
  if (actor.platformRole !== candidate?.platformRole) throw new ForbiddenException('Staff access changed; retry');
  if (actor.platformRole === 'SUPPORT' && config.get<string>('SALES_INTAKE_SUPPORT_ENABLED') !== 'true') throw new ForbiddenException('Staff intake support is not enabled');
  const items = await tx.salesEnquiry.findMany({ where: { id: { in: ids.map((row) => row.id) } }, select: { ...ENQUIRY_SELECT, consultations: { where: { status: 'SCHEDULED' }, select: { startsAt: true, endsAt: true }, orderBy: { startsAt: 'asc' }, take: 1 } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
  return page(items, limit, filters);
}

function queuePredicates(input: { userId: string; query: EnquiryQueueDto }, role: string | undefined, cursor: PageCursor | null) {
  const search = input.query.search?.trim().toLowerCase();
  const scope = role === 'ADMIN' ? Prisma.sql`true` : Prisma.sql`s."assignedUserId"=${input.userId}`;
  const searchFilter = search ? Prisma.sql`(c.email=${search} OR c.phone=${search} OR lower(c.name) LIKE ${`${search.replace(/[\\%_]/g, '\\$&')}%`})` : Prisma.sql`true`;
  const after = cursor ? Prisma.sql`(s."createdAt",s.id)<(${new Date(cursor.createdAt)}::timestamp,${cursor.id})` : Prisma.sql`true`;
  const stage = input.query.stage ? Prisma.sql`s.stage=${input.query.stage}::"EnquiryStage"` : Prisma.sql`true`;
  return { scope, searchFilter, after, stage };
}

export async function readSection(tx: Prisma.TransactionClient, enquiryId: string, input: { section: 'notes' | 'activities' | 'consultations'; query: EnquiryPageDto }) {
  const filters = { enquiryId, section: input.section };
  const cursor = decodeCursor(input.query.cursor, filters);
  const limit = input.query.limit ?? 50;
  const args = { where: { enquiryId, ...cursorWhere(cursor) }, orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }], take: limit + 1 };
  if (input.section === 'notes') return page(await tx.enquiryNote.findMany(args), limit, filters);
  if (input.section === 'activities') return page(await tx.enquiryActivity.findMany(args), limit, filters);
  return page(await tx.consultation.findMany(args), limit, filters);
}
