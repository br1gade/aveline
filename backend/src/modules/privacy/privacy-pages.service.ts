import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSubjectRequestStatus, Prisma } from '@prisma/client';
import { CursorBoundary, cursorPage, readCursor } from '../../common/cursor-pagination';
import { PrismaService } from '../../prisma/prisma.service';
import { PrivacyPageQuery, PrivacyQueue } from './dto/privacy-pages.dto';

const STATUSES: Record<PrivacyQueue, readonly DataSubjectRequestStatus[]> = {
  OPEN: ['RECEIVED', 'VERIFYING', 'IN_PROGRESS'], CLOSED: ['COMPLETED', 'REJECTED'],
};

@Injectable()
export class PrivacyPagesService {
  constructor(private readonly prisma: PrismaService) {}

  async page(query: PrivacyPageQuery) {
    const statuses = STATUSES[query.queue];
    if (query.status && !statuses.includes(query.status)) throw new BadRequestException('status: must belong to the selected queue');
    const filters = { domain: 'privacy-requests', queue: query.queue, status: query.status ?? null };
    const cursor = readCursor(query.cursor, filters);
    const orderBy: Prisma.DataSubjectRequestOrderByWithRelationInput[] = query.queue === PrivacyQueue.OPEN
      ? [{ dueAt: 'asc' }, { id: 'asc' }] : [{ completedAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }];
    const rows = await this.prisma.dataSubjectRequest.findMany({
      where: { status: query.status ?? { in: [...statuses] }, ...privacyAfter(cursor, query.queue) },
      orderBy, take: query.limit + 1,
    });
    return cursorPage(rows, query.limit, filters, (row) => ({
      id: row.id, at: query.queue === PrivacyQueue.OPEN ? row.dueAt : row.completedAt,
    }));
  }
}

function privacyAfter(cursor: CursorBoundary | null, queue: PrivacyQueue): Prisma.DataSubjectRequestWhereInput {
  if (!cursor) return {};
  if (queue === PrivacyQueue.OPEN) {
    if (cursor.at === null) throw new BadRequestException('cursor: invalid for these filters');
    return { OR: [{ dueAt: { gt: cursor.at } }, { dueAt: cursor.at, id: { gt: cursor.id } }] };
  }
  if (cursor.at === null) return { completedAt: null, id: { lt: cursor.id } };
  return { OR: [{ completedAt: { lt: cursor.at } }, { completedAt: cursor.at, id: { lt: cursor.id } }, { completedAt: null }] };
}
