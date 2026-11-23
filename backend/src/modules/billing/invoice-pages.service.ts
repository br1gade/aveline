import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { cursorPage, readDatedCursor } from '../../common/cursor-pagination';
import { PrismaService } from '../../prisma/prisma.service';
import { describeInvoice } from './billing-presenter';
import { InvoicePageQuery } from './dto/invoice-pages.dto';

@Injectable()
export class InvoicePagesService {
  constructor(private readonly prisma: PrismaService) {}

  async page(organizationId: string, query: InvoicePageQuery, locale = 'en') {
    const filters = { domain: 'invoices', organizationId };
    const cursor = readDatedCursor(query.cursor, filters);
    const after: Prisma.InvoiceWhereInput = cursor
      ? { OR: [{ createdAt: { lt: cursor.at } }, { createdAt: cursor.at, id: { lt: cursor.id } }] } : {};
    const rows = await this.prisma.invoice.findMany({
      where: { organizationId, ...after }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: query.limit + 1,
    });
    const page = cursorPage(rows, query.limit, filters, (row) => ({ id: row.id, at: row.createdAt }));
    return { ...page, items: page.items.map((invoice) => describeInvoice(invoice, locale)) };
  }
}
