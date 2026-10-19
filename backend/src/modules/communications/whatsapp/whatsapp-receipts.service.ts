import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { deriveWhatsAppUpdate } from './whatsapp-outcome';
import { parseWhatsAppReceipts, WhatsAppScope } from './whatsapp-payload';

const MESSAGE_STATE = { id: true, status: true, toAddress: true, deliveredAt: true, readAt: true, providerStatusAt: true } satisfies Prisma.MessageSelect;
const APPLICABLE_STATES = new Set(['SENDING', 'SENT', 'DELIVERED', 'FAILED']);

@Injectable()
export class WhatsAppReceiptsService {
  constructor(private readonly prisma: PrismaService) {}

  async receive(body: unknown, scope: WhatsAppScope): Promise<{ accepted: true }> {
    const data = await parseWhatsAppReceipts(body, scope);
    // One atomic bulk insert; no response acknowledges data held only in memory/Redis.
    if (data.length) await this.prisma.whatsAppReceipt.createMany({ data, skipDuplicates: true });
    return { accepted: true };
  }

  async reconcile(): Promise<void> {
    const now = Date.now();
    await this.prisma.$transaction([
      this.prisma.whatsAppReceipt.deleteMany({ where: { processedAt: null, receivedAt: { lt: new Date(now - 7 * 86400000) } } }),
      this.prisma.whatsAppReceipt.deleteMany({ where: { processedAt: { lt: new Date(now - 30 * 86400000) } } }),
    ]);
    const pending = await this.prisma.whatsAppReceipt.findMany({ where: { processedAt: null }, orderBy: [{ lastCheckedAt: { sort: 'asc', nulls: 'first' } }, { receivedAt: 'asc' }], take: 200, select: { receiptKey: true } });
    // At most 200 small transactions, five at once; unknown references rotate fairly.
    for (let start = 0; start < pending.length; start += 5) {
      await Promise.all(pending.slice(start, start + 5).map((row) => this.apply(row.receiptKey)));
    }
  }

  private async apply(receiptKey: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "receiptKey" FROM whatsapp_receipts WHERE "receiptKey" = ${receiptKey} FOR UPDATE`;
      const receipt = await tx.whatsAppReceipt.findUnique({ where: { receiptKey } });
      if (!receipt || receipt.processedAt) return;
      await tx.whatsAppReceipt.update({ where: { receiptKey }, data: { lastCheckedAt: new Date() } });
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM messages WHERE channel = 'WHATSAPP' AND direction = 'OUTBOUND'
        AND "providerAccountId" = ${receipt.accountId} AND "providerSenderId" = ${receipt.phoneNumberId}
        AND "providerRef" = ${receipt.providerRef} FOR UPDATE`;
      if (!rows.length) return; // An early callback is retried after the send's acknowledgement commits.
      const message = await tx.message.findUniqueOrThrow({ where: { id: rows[0].id }, select: MESSAGE_STATE });
      if (message.status === 'QUEUED') return;
      if (APPLICABLE_STATES.has(message.status) && message.toAddress !== '[erased]') {
        await tx.message.update({ where: { id: message.id }, data: deriveWhatsAppUpdate(message, receipt) });
      }
      await tx.whatsAppReceipt.update({ where: { receiptKey }, data: { processedAt: new Date() } });
    });
  }
}
