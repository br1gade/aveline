import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { CommunicationsService } from '../communications/communications.service';

@Injectable()
export class TicketAcknowledgementInviter implements OnModuleInit {
  private readonly appUrl: string;
  constructor(private readonly prisma: PrismaService, private readonly communications: CommunicationsService, config: ConfigService) {
    this.appUrl = config.get<string>('PUBLIC_APP_URL') ?? 'http://localhost:5173';
  }
  onModuleInit() {
    this.communications.checkBeforeSending('ticket.acknowledgement', async (message) => {
      if (!message.guestId || !message.eventId) return false;
      return await this.prisma.guest.count({ where: { id: message.guestId, eventId: message.eventId, anonymizedAt: null,
        email: { equals: message.toAddress, mode: 'insensitive' }, ticket: { status: 'VALID', order: { status: 'PAID' } },
        event: { invitation: { status: { in: ['PUBLISHED', 'CLOSED'] }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } } } }) > 0;
    });
  }
  async sendMissing(limit = 50) {
    const rows = await this.prisma.$queryRaw<AttendeeLink[]>`SELECT t.id AS "ticketId", g.id AS "guestId", g."firstName", g."lastName", g.email,
      COALESCE(g.locale, e."defaultLocale") AS locale, g.token, i.slug, e.id AS "eventId", e."organizationId", e.title
      FROM tickets t JOIN ticket_orders o ON o.id = t."orderId" JOIN guests g ON g.id = t."guestId"
      JOIN events e ON e.id = g."eventId" JOIN invitations i ON i."eventId" = e.id
      WHERE t.status = 'VALID' AND o.status = 'PAID' AND g."anonymizedAt" IS NULL AND g.email IS NOT NULL
        AND i.status IN ('PUBLISHED', 'CLOSED') AND (i."expiresAt" IS NULL OR i."expiresAt" > now())
        AND EXISTS (SELECT 1 FROM rsvp_questions q WHERE q."invitationId" = i.id AND q.type = 'SIGNATURE' AND q.required)
        AND NOT EXISTS (SELECT 1 FROM messages m WHERE m."dedupeKey" = 'ticket-ack:' || t.id || ':' || g.id)
      ORDER BY o."createdAt", t.id LIMIT ${Math.max(1, Math.min(100, limit))}`;
    if (!rows.length) return { queued: 0 };
    await this.communications.enqueueMany(rows.map((row) => ({ organizationId: row.organizationId, eventId: row.eventId, guestId: row.guestId,
      channel: 'EMAIL', templateKey: 'ticket.acknowledgement', toAddress: row.email, locale: row.locale,
      variables: { guestName: [row.firstName, row.lastName].filter(Boolean).join(' '), eventTitle: row.title,
        link: `${this.appUrl}/invitations/${row.slug}/g/${row.token}` }, dedupeKey: `ticket-ack:${row.ticketId}:${row.guestId}` })));
    return { queued: rows.length };
  }
}
interface AttendeeLink {
  ticketId: string; guestId: string; firstName: string; lastName: string | null; email: string; locale: string; token: string; slug: string;
  eventId: string; organizationId: string; title: string;
}
