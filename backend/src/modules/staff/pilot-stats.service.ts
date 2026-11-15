import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { INVITATION_EMAIL_TEMPLATE } from '../communications/telegram-opt-in';

/** Totals across every customer, from which the pilot's success is read (audit Q6). */
export interface PilotStats {
  /** Organizations that created at least one event. */
  hosts: number;
  /** Invitations a provider accepted or delivered, on any channel. */
  invitationsSent: number;
  guests: number;
  /** Guests who gave any answer. */
  guestsReplied: number;
  guestsAttending: number;
  /** Guests checked in at the door, whatever they answered. */
  guestsCheckedIn: number;
}

type PilotStatsRow = { [Key in keyof PilotStats]: bigint };

@Injectable()
export class PilotStatsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * One read, counted in Postgres. An organization Aveline staff own is a
   * rehearsal or a concierge setup, not a customer, so its events are left out.
   */
  async totals(): Promise<PilotStats> {
    const [row] = await this.prisma.$queryRaw<PilotStatsRow[]>(Prisma.sql`
      WITH customer_events AS (
        SELECT e.id, e."organizationId"
        FROM events e
        JOIN organizations o ON o.id = e."organizationId" AND o."deletedAt" IS NULL
        WHERE EXISTS (
          SELECT 1 FROM organization_memberships m JOIN users u ON u.id = m."userId"
          WHERE m."organizationId" = o.id AND m.role = 'OWNER' AND u."platformRole" = 'NONE'
        )
      )
      SELECT
        (SELECT count(DISTINCT "organizationId") FROM customer_events) AS hosts,
        (SELECT count(*) FROM messages msg
          WHERE msg."eventId" IN (SELECT id FROM customer_events)
            AND msg."templateKey" = ${INVITATION_EMAIL_TEMPLATE} AND msg.status IN ('SENT', 'DELIVERED')) AS "invitationsSent",
        count(g.id) AS guests,
        count(g.id) FILTER (WHERE r.status <> 'PENDING') AS "guestsReplied",
        count(g.id) FILTER (WHERE r.status = 'ATTENDING') AS "guestsAttending",
        count(c.id) AS "guestsCheckedIn"
      FROM customer_events ce
      JOIN guests g ON g."eventId" = ce.id
      LEFT JOIN rsvps r ON r."guestId" = g.id
      LEFT JOIN check_ins c ON c."guestId" = g.id
    `);
    return {
      hosts: Number(row.hosts),
      invitationsSent: Number(row.invitationsSent),
      guests: Number(row.guests),
      guestsReplied: Number(row.guestsReplied),
      guestsAttending: Number(row.guestsAttending),
      guestsCheckedIn: Number(row.guestsCheckedIn),
    };
  }
}
