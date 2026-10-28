import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { compactGuestPageChanges } from './guest-page-version';

@Injectable()
export class InvitationMaintenanceService {
  private readonly logger = new Logger(InvitationMaintenanceService.name);
  private legacyCount = -1;
  constructor(private readonly prisma: PrismaService) {}

  async maintain(now = new Date()) {
    const result = await this.prisma.$transaction(async (tx) => {
      const legacy = await tx.$executeRaw`WITH batch AS (
        SELECT id FROM invitations WHERE status <> 'DRAFT' AND "lifetimeSource" IS NULL ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 100)
        UPDATE invitations i SET "lifetimeSource" = 'LEGACY' FROM batch b WHERE i.id = b.id`;
      const expired = await tx.$executeRaw`WITH batch AS (
        SELECT id FROM invitations WHERE status <> 'DRAFT' AND "expiresAt" <= ${now} AND "expiryProcessedAt" IS NULL
        ORDER BY "expiresAt", id FOR UPDATE SKIP LOCKED LIMIT 100)
        UPDATE invitations i SET "expiryProcessedAt" = ${now} FROM batch b WHERE i.id = b.id`;
      return { legacyMarked: legacy, expiriesProcessed: expired, ...await compactGuestPageChanges(tx) };
    });
    const legacyInvitations = await this.prisma.invitation.count({ where: { lifetimeSource: 'LEGACY' } });
    if (legacyInvitations !== this.legacyCount && legacyInvitations > 0) this.logger.warn({ code: 'INVITATION_LEGACY_LIFETIME_REVIEW', count: legacyInvitations });
    this.legacyCount = legacyInvitations;
    if (result.expiriesProcessed > 0) this.logger.log({ code: 'INVITATION_ACCESS_EXPIRED', count: result.expiriesProcessed });
    return { ...result, legacyInvitations };
  }
}
